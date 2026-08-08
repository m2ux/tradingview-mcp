# Architecture Guide

This document describes the architecture for managing engineering artifacts.

## Overview

Engineering artifacts should be:
- **Version-controlled** — Full history of decisions
- **Co-located** — Accessible alongside code
- **Separated** — Engineering history distinct from code history

## Directory Structure

- `artifacts/adr/` - Architecture Decision Records
- `artifacts/planning/` - Work package plans and specifications
- `artifacts/reviews/` - Code and architecture reviews
- `artifacts/templates/` - Reusable documentation templates
- `workflows/` - Workflow definitions (submodule)
- `history/` - Project history (orphan branch submodule)
- `scripts/` - Utility scripts
