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
  description = "Target runtime profile: local, testnet, or mainnet"
  default     = "testnet"
  validation {
    condition     = contains(["local", "testnet", "mainnet"], var.environment)
    error_message = "environment must be local, testnet, or mainnet"
  }
}

variable "monad_chain_id" {
  type        = number
  description = "Monad Parallel EVM chain identifier"
  default     = 10143
}

resource "kubernetes_namespace" "agentguard" {
  metadata {
    name = "agentguard"
    labels = {
      environment = var.environment
      system      = "agentguard-agentic-risk"
    }
  }
}
