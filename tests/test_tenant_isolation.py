"""
Automated Tenant Isolation and Security Boundary Test Suite
Verifies:
1. Phase 5.1: Storage Isolation (STS temporary credentials return S3 403 Access Denied on cross-tenant access)
2. Phase 5.2: Catalog & Query Isolation (Rejects cross-tenant table references, schema injection, and catalog escapes)
3. Phase 5.3: RBAC & Permission Verification
"""

import os
import json
import pytest
import boto3
import httpx
from botocore.exceptions import ClientError

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://storage:9000")
S3_ROOT_USER = os.getenv("S3_ROOT_USER", "lakehouse_storage_admin")
S3_ROOT_PASSWORD = os.getenv("S3_ROOT_PASSWORD", "storage_secret_change_me")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "lakehouse-bucket")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
WEB_URL = os.getenv("WEB_URL", "http://web:3000")


@pytest.fixture(scope="session")
def s3_admin():
    """Returns root administrative S3 client."""
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ROOT_USER,
        aws_secret_access_key=S3_ROOT_PASSWORD,
        region_name=S3_REGION,
    )


@pytest.fixture(scope="session")
def sts_client():
    """Returns STS client connected to RustFS."""
    return boto3.client(
        "sts",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ROOT_USER,
        aws_secret_access_key=S3_ROOT_PASSWORD,
        region_name=S3_REGION,
    )


@pytest.fixture(scope="session")
def seed_tenants_storage(s3_admin):
    """Seeds test data under tenant_a and tenant_b prefixes."""
    # Ensure bucket exists
    existing = [b["Name"] for b in s3_admin.list_buckets().get("Buckets", [])]
    if S3_BUCKET not in existing:
        s3_admin.create_bucket(Bucket=S3_BUCKET)

    # Seed Tenant A file
    s3_admin.put_object(
        Bucket=S3_BUCKET,
        Key="tenants/tenant_a/raw/sample.csv",
        Body=b"id,name\n1,Alpha Corp\n2,Beta LLC\n",
    )

    # Seed Tenant B confidential file
    s3_admin.put_object(
        Bucket=S3_BUCKET,
        Key="tenants/tenant_b/raw/confidential_financials.csv",
        Body=b"account,balance\n99901,15000000.00\n99902,4200000.00\n",
    )

    # Seed Tenant Acme customers in Silver layer
    try:
        httpx.post(
            f"{WEB_URL}/api/pipeline/ingest",
            data={"tenant_id": "tenant_acme", "table_name": "customers"},
            files={"file": ("customers.csv", b"id,name\n1,Acme Inc\n2,Acme Direct\n", "text/csv")},
            timeout=10.0,
        )
    except Exception:
        pass


def test_5_1_storage_isolation_sts_denies_cross_tenant_access(sts_client, seed_tenants_storage):
    """
    Phase 5.1 Storage Isolation Test (Critical Acceptance Criteria):
    Tenant A's STS-scoped credentials MUST receive an explicit S3 403 Access Denied
    (not 404, not empty list) when attempting GET or LIST under tenants/tenant_b/*.
    """
    # Policy scoped strictly to tenant_a
    tenant_a_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                "Resource": [f"arn:aws:s3:::{S3_BUCKET}/tenants/tenant_a/*"],
            },
            {
                "Effect": "Allow",
                "Action": ["s3:ListBucket"],
                "Resource": [f"arn:aws:s3:::{S3_BUCKET}"],
                "Condition": {
                    "StringLike": {"s3:prefix": ["tenants/tenant_a/*"]}
                },
            },
        ],
    }

    # Assume tenant role
    res = sts_client.assume_role(
        RoleArn="arn:aws:iam:::role/tenant-role",
        RoleSessionName="tenant_a_automated_test_session",
        Policy=json.dumps(tenant_a_policy),
        DurationSeconds=3600,
    )
    creds = res["Credentials"]
    assert "AccessKeyId" in creds
    assert "SecretAccessKey" in creds
    assert "SessionToken" in creds

    # Build client using Tenant A temporary credentials
    s3_tenant_a = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
        region_name=S3_REGION,
    )

    # 1. Tenant A CAN write and read to tenant_a
    s3_tenant_a.put_object(
        Bucket=S3_BUCKET,
        Key="tenants/tenant_a/test_write.txt",
        Body=b"Tenant A private data",
    )
    obj = s3_tenant_a.get_object(Bucket=S3_BUCKET, Key="tenants/tenant_a/test_write.txt")
    assert obj["Body"].read() == b"Tenant A private data"

    # 2. Tenant A CANNOT get Tenant B's confidential object -> Must return HTTP 403 AccessDenied
    with pytest.raises(ClientError) as exc_info:
        s3_tenant_a.get_object(
            Bucket=S3_BUCKET,
            Key="tenants/tenant_b/raw/confidential_financials.csv",
        )
    error_response = exc_info.value.response
    http_status = error_response["ResponseMetadata"]["HTTPStatusCode"]
    error_code = error_response["Error"]["Code"]

    assert http_status == 403, f"Expected HTTP 403 Access Denied, got {http_status}"
    assert error_code == "AccessDenied", f"Expected 'AccessDenied' code, got {error_code}"

    # 3. Tenant A CANNOT list objects under Tenant B -> Must return HTTP 403 AccessDenied
    with pytest.raises(ClientError) as exc_list_info:
        s3_tenant_a.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix="tenants/tenant_b/",
        )
    list_error = exc_list_info.value.response
    list_status = list_error["ResponseMetadata"]["HTTPStatusCode"]
    list_code = list_error["Error"]["Code"]

    assert list_status == 403, f"Expected HTTP 403 on cross-tenant list, got {list_status}"
    assert list_code == "AccessDenied", f"Expected 'AccessDenied' code, got {list_code}"


def test_5_2_query_isolation_rejects_cross_tenant_table_access(seed_tenants_storage):
    """
    Phase 5.2 Catalog & Query Isolation Test:
    Attempting to query another tenant's table (e.g. tenant_b_customers) while scoped to
    tenant_acme MUST be rejected before DuckDB execution with HTTP 403.
    """
    client = httpx.Client(base_url=WEB_URL, timeout=10.0)

    # 1. Cross-tenant table reference
    res = client.post(
        "/api/query",
        json={"query": "SELECT * FROM tenant_b_customers", "tenant_id": "tenant_acme"},
    )
    assert res.status_code == 403, f"Expected 403 Forbidden, got {res.status_code}: {res.text}"
    data = res.json()
    assert "Cross-tenant table access prohibited" in data["error"]

    # 2. SQL injection / foreign schema prefix
    res_schema = client.post(
        "/api/query",
        json={"query": "SELECT * FROM tenant_b.customers", "tenant_id": "tenant_acme"},
    )
    assert res_schema.status_code == 403, f"Expected 403, got {res_schema.status_code}"
    assert "Access Denied" in res_schema.json()["error"]

    # 3. Catalog schema escape attempt
    res_cat = client.post(
        "/api/query",
        json={"query": "SELECT * FROM ducklake_catalog.tables", "tenant_id": "tenant_acme"},
    )
    assert res_cat.status_code == 403, f"Expected 403, got {res_cat.status_code}"
    assert "ducklake_catalog" in res_cat.json()["error"]

    # 4. Prohibited DDL/DML statement
    res_drop = client.post(
        "/api/query",
        json={"query": "DROP TABLE tenant_acme_customers", "tenant_id": "tenant_acme"},
    )
    assert res_drop.status_code == 403, f"Expected 403, got {res_drop.status_code}"
    assert "drop" in res_drop.json()["error"].lower()

    # Ingest tenant_acme customers table via worker pipeline
    client.post(
        "/api/pipeline/ingest",
        data={"tenant_id": "tenant_acme", "table_name": "customers"},
        files={"file": ("customers.csv", b"id,name\n1,Acme Inc\n2,Acme Direct\n", "text/csv")},
    )

    # 5. Legitimate query for own tenant succeeds
    res_legit = client.post(
        "/api/query",
        json={"query": "SELECT * FROM tenant_acme_silver.customers LIMIT 2", "tenant_id": "tenant_acme"},
    )
    assert res_legit.status_code == 200, f"Legitimate query failed: {res_legit.text}"
    legit_data = res_legit.json()
    assert "columns" in legit_data
    assert "rows" in legit_data
    assert len(legit_data["rows"]) <= 2


def test_5_3_table_explorer_scoped_to_tenant():
    """
    Phase 5.3 Verification: Table explorer only returns tables scoped to the tenant.
    """
    client = httpx.Client(base_url=WEB_URL, timeout=10.0)
    res = client.get("/api/tables?tenant_id=tenant_acme")
    assert res.status_code == 200
    data = res.json()
    assert "tables" in data
    # All returned tables must belong to tenant_acme
    for table in data["tables"]:
        assert (
            table["full_name"].startswith("tenant_acme_") or
            table.get("schema", "").startswith("tenant_acme_")
        ), f"Table {table['full_name']} leaked into tenant_acme catalog"


def test_5_4_medallion_gold_view_rejects_cross_tenant_reference():
    """
    Medallion Architecture Isolation Test:
    A Gold view in Tenant A attempting to reference Tenant B's Silver tables
    MUST be rejected before creation with HTTP 403.
    """
    client = httpx.Client(base_url=WEB_URL, timeout=10.0)

    # Tenant A attempts to create a Gold view selecting from Tenant B
    res = client.post(
        "/api/gold",
        json={
            "tenant_id": "tenant_acme",
            "name": "sneaky_view",
            "query": "SELECT * FROM tenant_b_silver.customers",
            "action": "view",
        },
    )
    assert res.status_code == 403, f"Expected 403 Forbidden, got {res.status_code}: {res.text}"
    err_text = res.json().get("error", "")
    assert "Cross-tenant schema access prohibited" in err_text or "Access Denied" in err_text


def test_5_5_dataset_deletion_preserves_other_tenants(s3_admin):
    """
    Dataset Deletion Lifecycle Test:
    Deleting a dataset in Tenant A must purge Tenant A's specific storage prefix
    while preserving Tenant B's storage and catalog unaffected.
    """
    client = httpx.Client(base_url=WEB_URL, timeout=10.0)

    # 1. Seed Tenant A and Tenant B tables
    s3_admin.put_object(
        Bucket=S3_BUCKET,
        Key="tenants/tenant_a/tables/orders/part_1.parquet",
        Body=b"PAR1_test_content_tenant_a",
    )
    s3_admin.put_object(
        Bucket=S3_BUCKET,
        Key="tenants/tenant_b/tables/orders/part_1.parquet",
        Body=b"PAR1_test_content_tenant_b",
    )

    # 2. Delete Tenant A table
    res_del = client.post(
        "/api/datasets/delete",
        json={
            "tenant_id": "tenant_a",
            "name": "orders",
            "layer": "silver",
            "object_type": "table",
            "force": True,
        },
    )
    assert res_del.status_code == 200, f"Deletion failed: {res_del.text}"

    # 3. Verify Tenant B object still exists in RustFS
    obj_b = s3_admin.get_object(
        Bucket=S3_BUCKET,
        Key="tenants/tenant_b/tables/orders/part_1.parquet",
    )
    assert obj_b["Body"].read() == b"PAR1_test_content_tenant_b"

    # 4. Verify Tenant A specific prefix is purged
    list_a = s3_admin.list_objects_v2(
        Bucket=S3_BUCKET,
        Prefix="tenants/tenant_a/tables/orders/",
    )
    assert "Contents" not in list_a or len(list_a["Contents"]) == 0

