#!/usr/bin/env bash
# One-time idempotent setup for GCP benchmark infrastructure.
# Safe to re-run — each command checks for existing resources.
#
# Prerequisites:
#   - gcloud CLI authenticated with access to the saffron-health project
#   - Secret "anthropic-api-key" already exists in Secret Manager
#   - Secret "kernel-api-key-libretto-benchmarks" already exists in Secret Manager
#
# Usage:
#   bash benchmarks/infra/setup.sh

set -euo pipefail

PROJECT=saffron-health
REGION=us-central1
BUCKET=libretto-benchmarks
AR_REPO=libretto-benchmarks
JOB_NAME=webvoyager-bench
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/webvoyager:latest"

echo "==> Setting project to ${PROJECT}"
gcloud config set project "${PROJECT}" --quiet

# --- GCS bucket ---
echo "==> Creating GCS bucket gs://${BUCKET} (if not exists)"
gcloud storage buckets describe "gs://${BUCKET}" --quiet 2>/dev/null \
  || gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" --quiet

# --- Artifact Registry repository ---
echo "==> Creating Artifact Registry repo ${AR_REPO} (if not exists)"
gcloud artifacts repositories describe "${AR_REPO}" \
  --location="${REGION}" --quiet 2>/dev/null \
  || gcloud artifacts repositories create "${AR_REPO}" \
       --repository-format=docker \
       --location="${REGION}" \
       --quiet

# --- Cloud Run Job ---
# The image may not exist yet (built in Phase 2). Cloud Run accepts the
# reference and just flags it as not-found until we push.
echo "==> Creating Cloud Run Job ${JOB_NAME} (if not exists)"
if gcloud run jobs describe "${JOB_NAME}" --region="${REGION}" --quiet 2>/dev/null; then
  echo "    Job already exists — updating configuration"
  gcloud run jobs update "${JOB_NAME}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --task-timeout=7200s \
    --max-retries=1 \
    --cpu=4 \
    --memory=8Gi \
    --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,KERNEL_API_KEY=kernel-api-key-libretto-benchmarks:latest \
    --quiet
else
  gcloud run jobs create "${JOB_NAME}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --task-timeout=7200s \
    --max-retries=1 \
    --cpu=4 \
    --memory=8Gi \
    --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,KERNEL_API_KEY=kernel-api-key-libretto-benchmarks:latest \
    --quiet
fi

echo ""
echo "✅ Infrastructure setup complete."
echo "   Bucket:    gs://${BUCKET}"
echo "   AR Repo:   ${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}"
echo "   Cloud Run: ${JOB_NAME} (${REGION})"
