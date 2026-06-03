#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="saffron-health"
REGION="us-central1"
BUCKET="libretto-benchmarks"
ARTIFACT_REPO="libretto-benchmarks"
JOB_NAME="libretto-evals"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/evals:latest"

gcloud config set project "${PROJECT_ID}" --quiet

gcloud storage buckets describe "gs://${BUCKET}" --quiet 2>/dev/null \
  || gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" --quiet

gcloud artifacts repositories create "${ARTIFACT_REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Libretto benchmark and eval Docker images" \
  --quiet \
  2>/dev/null || true

if ! gcloud artifacts docker images describe "${IMAGE}" --quiet >/dev/null 2>&1; then
  echo "Building bootstrap eval image ${IMAGE}"
  gcloud builds submit \
    --project "${PROJECT_ID}" \
    --config evals/cloudbuild.yaml \
    --substitutions "_IMAGE=${IMAGE}" \
    --timeout 3600s \
    --machine-type e2-highcpu-8 \
    .
fi

if gcloud run jobs describe "${JOB_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  gcloud run jobs update "${JOB_NAME}" \
    --region "${REGION}" \
    --image "${IMAGE}" \
    --tasks 1 \
    --parallelism 1 \
    --task-timeout 7200s \
    --cpu 2 \
    --memory 8Gi \
    --max-retries 1 \
    --set-secrets OPENAI_API_KEY=libretto-test-openai-api-key:latest,KERNEL_API_KEY=kernel-api-key-libretto-benchmarks:latest,STEEL_API_KEY=libretto-benchmarks-steel-api-key:latest \
    --quiet
else
  gcloud run jobs create "${JOB_NAME}" \
    --region "${REGION}" \
    --image "${IMAGE}" \
    --tasks 1 \
    --parallelism 1 \
    --task-timeout 7200s \
    --cpu 2 \
    --memory 8Gi \
    --max-retries 1 \
    --set-secrets OPENAI_API_KEY=libretto-test-openai-api-key:latest,KERNEL_API_KEY=kernel-api-key-libretto-benchmarks:latest,STEEL_API_KEY=libretto-benchmarks-steel-api-key:latest \
    --quiet
fi

echo "Cloud Run eval job is ready: ${JOB_NAME}"
