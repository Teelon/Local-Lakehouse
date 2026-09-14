#!/bin/sh
set -e

echo "==> Configuring Object Storage..."

# Wait for storage service to become available
until /usr/bin/mc alias set local http://storage:9000 "$S3_ROOT_USER" "$S3_ROOT_PASSWORD"; do
  echo "Waiting for storage endpoint at http://storage:9000..."
  sleep 2
done

echo "==> Storage endpoint connected."

# Create default lakehouse bucket if it does not exist
if ! /usr/bin/mc ls local/"$S3_BUCKET_NAME" > /dev/null 2>&1; then
  echo "==> Creating bucket: $S3_BUCKET_NAME"
  /usr/bin/mc mb local/"$S3_BUCKET_NAME"
else
  echo "==> Bucket $S3_BUCKET_NAME already exists."
fi

echo "==> Initializing tenant template paths..."
# Touch placeholder objects to establish default prefixes
/usr/bin/mc cp /dev/null local/"$S3_BUCKET_NAME"/tenants/.keep > /dev/null 2>&1 || true

echo "==> Object storage initialization complete."
