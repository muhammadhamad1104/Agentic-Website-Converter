#!/bin/bash
set -e

echo "======================================"
echo " Starting Deployment Automation "
echo "======================================"

# 1. Apply Terraform
echo "1. Initializing and Applying Terraform..."
cd infra/terraform-eks
terraform init
terraform apply -auto-approve
cd ../../

# 2. Update Kubeconfig
echo "2. Updating kubeconfig for EKS..."
CLUSTER_NAME=$(terraform -chdir=infra/terraform-eks output -raw cluster_name)
REGION=$(terraform -chdir=infra/terraform-eks output -raw region 2>/dev/null || echo "us-east-1")
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$REGION"

# 3. Apply Kubernetes Manifests
echo "3. Applying Kubernetes Manifests..."
kubectl apply -f infra/k8s/deployment.yaml

# 4. Wait for deployments
echo "4. Waiting for deployments to become ready..."
kubectl rollout status deployment/postgres -n agentic-converter
kubectl rollout status deployment/redis -n agentic-converter
kubectl rollout status deployment/backend -n agentic-converter
kubectl rollout status deployment/worker -n agentic-converter
kubectl rollout status deployment/frontend -n agentic-converter

echo "======================================"
echo " Deployment Complete! "
echo "======================================"
