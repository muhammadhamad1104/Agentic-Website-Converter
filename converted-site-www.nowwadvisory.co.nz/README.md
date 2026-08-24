# Converted Dynamic Full-Stack Application

This package was automatically synthesized from your converted static website structure (**https://www.nowwadvisory.co.nz**). It includes a complete **Node.js Express Backend** (with Prisma ORM and SQLite/PostgreSQL) and a **React Single-Page Application (Frontend)**.

---

## 📊 Conversion Summary
- **Source URL**: https://www.nowwadvisory.co.nz
- **Generated Pages**:
- `https://www.nowwadvisory.co.nz/`
- `https://www.nowwadvisory.co.nz/about`
- `https://www.nowwadvisory.co.nz/contact`
- `https://www.nowwadvisory.co.nz/legal/privacy-policy`
- `https://www.nowwadvisory.co.nz/legal/terms-of-use`
- `https://www.nowwadvisory.co.nz/process`
- `https://www.nowwadvisory.co.nz/services`
- **Inferred Database Entities (4)**:
- `users`
- `sessions`
- `aboutus`
- `contactus`

---

## 📋 Requirements
- **Node.js**: `v18.0.0` or higher (v20+ recommended)
- **npm**: `v9.0.0` or higher

---

## 🚀 How to Run the Application

### 1. Start the Backend API Server
```bash
# Navigate to backend directory
cd backend

# Install backend dependencies
npm install

# Start the backend development server
npm run dev
```
* **Backend API Base URL**: `http://localhost:5000` (or port specified in `backend/.env`)
* **Health Check Endpoint**: `http://localhost:5000/api/health`

### 2. Start the Frontend Web Application
```bash
# Open a new terminal and navigate to frontend directory
cd frontend

# Install frontend dependencies
npm install

# Start the React Vite development server
npm run dev
```
* **Frontend Web Application**: `http://localhost:5173` (or `http://localhost:3000`)

---

## 📁 Project Structure Overview

```
project-root/
├── README.md               <-- Getting Started & Instructions
├── backend/                <-- Node.js Express REST API
│   ├── src/
│   │   ├── controllers/    <-- Request Handlers
│   │   ├── routes/         <-- REST Express Routes
│   │   └── server.ts       <-- Server Entry Point
│   ├── prisma/             <-- Database Schema & Models
│   └── package.json
└── frontend/               <-- React + Vite Web Application
    ├── src/
    │   ├── components/     <-- Extracted UI Components
    │   ├── pages/          <-- Crawled & Converted Pages
    │   ├── services/       <-- API Service Client
    │   └── App.tsx         <-- Main Router & App Shell
    └── package.json
```

---

## ⚙️ Architecture & Features
- **Type-Safe Database Models**: Auto-generated Prisma ORM schema.
- **Dynamic REST API**: CRUD endpoints for inferred models.
- **Modular React UI**: Components structured from extracted layout tree.
