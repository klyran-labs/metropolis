terraform {
  required_version = ">= 1.5.0"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30.0"
    }
  }
}

variable "environment" {
  type        = string
  description = "Target deployment environment: local, testnet, staging, or production"
  default     = "testnet"
}

variable "monad_chain_id" {
  type        = number
  description = "Monad Parallel EVM chain identifier"
  default     = 10143
}

resource "kubernetes_namespace" "computex" {
  metadata {
    name = "computex"
    labels = {
      environment = var.environment
      system      = "computex-depin"
    }
  }
}
