# Meter Reading & Billing System API

A Node.js + Express RESTful API for managing **buildings, tenants, stalls, meters, readings, billing, users, and utility rates** in a market/building scenario.  
It supports **JWT-based authentication**, **role- and building-based authorization**, and **utility-specific access control** for billers.

---

## ✨ Features
- JWT authentication:contentReference[oaicite:0]{index=0}
- Role-based authorization: `admin`, `operator`, `biller`:contentReference[oaicite:1]{index=1}
- Building- and utility-based scoping:contentReference[oaicite:2]{index=2}:contentReference[oaicite:3]{index=3}
- CRUD APIs for buildings, tenants, stalls, meters, readings, rates, users:contentReference[oaicite:4]{index=4}:contentReference[oaicite:5]{index=5}:contentReference[oaicite:6]{index=6}:contentReference[oaicite:7]{index=7}:contentReference[oaicite:8]{index=8}:contentReference[oaicite:9]{index=9}:contentReference[oaicite:10]{index=10}
- Tenant `tenant_status` (inactive frees stalls):contentReference[oaicite:11]{index=11}
- Billing calculations with downtime segmentation:contentReference[oaicite:12]{index=12}
- Sequelize migrations + seeders:contentReference[oaicite:13]{index=13}

---

## ⚡ Quick Start

To run the application from scratch:

```bash
# 1. Download or create a .env file with your DB and JWT configs
# 2. Install dependencies
npm install

# 3. Initialize database (create → migrate → seed)
npm run db:init

# 4. Verify migration status
npm run db:status

# 5. Run the app in dev mode (with nodemon)
npm run dev
