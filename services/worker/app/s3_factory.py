"""
s3_factory.py

Centralized S3 client factory for the Python worker.
Provides tenant-scoped temporary credentials via STS AssumeRole for operations
that touch a specific tenant's prefix (e.g. dataset/tenant deletion prefix purges),
while maintaining root-credentialed client access for admin tasks.

NOTE: As documented in Addendum v2 Section 4, DuckDB's httpfs S3 configuration
remains on admin credentials because DuckLake catalog-managed data files are
stored under s3://.../ducklake/, not under tenants/{tenant_id}/.
"""

import os
import json
import logging
from typing import Dict, Any, Optional
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger("s3-factory")

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://storage:9000")
S3_ACCESS_KEY = os.getenv("S3_ROOT_USER", "lakehouse_storage_admin")
S3_SECRET_KEY = os.getenv("S3_ROOT_PASSWORD", "storage_secret_change_me")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "lakehouse-bucket")
S3_REGION = os.getenv("S3_REGION", "us-east-1")


def get_tenant_scoped_credentials(tenant_id: str) -> Dict[str, Any]:
    """
    Obtains temporary STS-scoped credentials restricted to tenants/{tenant_id}/*
    in the lakehouse bucket. Falls back to root credentials if STS is unavailable.
    """
    try:
        sts = boto3.client(
            "sts",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION,
        )

        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "s3:GetObject",
                        "s3:PutObject",
                        "s3:DeleteObject",
                    ],
                    "Resource": [f"arn:aws:s3:::{S3_BUCKET}/tenants/{tenant_id}/*"],
                },
                {
                    "Effect": "Allow",
                    "Action": ["s3:ListBucket"],
                    "Resource": [f"arn:aws:s3:::{S3_BUCKET}"],
                    "Condition": {
                        "StringLike": {
                            "s3:prefix": [f"tenants/{tenant_id}/*"]
                        }
                    },
                },
            ],
        }

        resp = sts.assume_role(
            RoleArn="arn:aws:iam:::role/tenant-scoped-worker-role",
            RoleSessionName=f"worker_session_{tenant_id}",
            Policy=json.dumps(policy),
            DurationSeconds=3600,
        )

        creds = resp.get("Credentials", {})
        return {
            "access_key_id": creds["AccessKeyId"],
            "secret_access_key": creds["SecretAccessKey"],
            "session_token": creds.get("SessionToken"),
        }
    except Exception as e:
        logger.warning(
            f"STS AssumeRole failed for tenant '{tenant_id}'; falling back to root credentials. Error: {e}"
        )
        return {
            "access_key_id": S3_ACCESS_KEY,
            "secret_access_key": S3_SECRET_KEY,
            "session_token": None,
        }


class S3ClientFactory:
    """
    Factory for creating boto3 S3 clients with appropriate credential scoping.
    """

    @staticmethod
    def create_tenant_client(tenant_id: str):
        """
        Returns a boto3 S3 client with STS-scoped credentials restricted to
        tenants/{tenant_id}/* paths. Use for dataset and tenant deletion prefix purges.
        """
        creds = get_tenant_scoped_credentials(tenant_id)
        session_kwargs = {
            "aws_access_key_id": creds["access_key_id"],
            "aws_secret_access_key": creds["secret_access_key"],
        }
        if creds.get("session_token"):
            session_kwargs["aws_session_token"] = creds["session_token"]

        return boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            region_name=S3_REGION,
            **session_kwargs,
        )

    @staticmethod
    def create_admin_client():
        """
        Returns a root-credentialed boto3 S3 client for admin tasks
        (bucket provisioning, storage tenant discovery).
        """
        return boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION,
        )
