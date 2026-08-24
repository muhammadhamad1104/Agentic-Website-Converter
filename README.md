# Agentic Static to Dynamic Website Converter

Welcome to the **Agentic Static to Dynamic Website Converter**! This project utilizes autonomous AI agents to analyze, parse, and intelligently convert static websites (HTML/CSS/JS) into fully dynamic, full-stack applications with databases, API routes, and React frontends.

This repository is structured as a monorepo consisting of three main microservices: the **Frontend**, the **Backend**, and the **AI Worker**. 

---

## 🏗️ Architecture & Technologies

The platform leverages modern, cutting-edge technologies across all layers of the stack:

### 1. Frontend (`apps/frontend`)
The user interface is a highly interactive, 3D-animated web application designed to be visually stunning and intuitive.
- **Framework:** React 19 (TypeScript) & Vite
- **Styling:** Tailwind CSS & Radix UI (accessible headless components)
- **Animations & 3D:** Three.js (React Three Fiber), Framer Motion, and GSAP
- **State & Routing:** React Router DOM v6
- **Testing:** Vitest with JSDOM and React Testing Library

### 2. Backend (`apps/backend`)
A robust, scalable REST API that manages users, sites, conversion jobs, and orchestrates tasks.
- **Framework:** Node.js with Express & TypeScript
- **Database ORM:** Prisma Client (v5)
- **Database:** PostgreSQL (for robust relational data storage)
- **Job Queues:** BullMQ backed by Redis for asynchronous job processing
- **Authentication:** JWT (JSON Web Tokens) with Argon2 password hashing
- **Testing:** Jest & Supertest

### 3. AI Worker (`apps/worker`)
The brain of the platform. This service processes the actual website conversion using Large Language Models and specialized agents.
- **Framework:** Python & FastAPI
- **AI Orchestration:** LangGraph (for multi-agent workflows)
- **Capabilities:** Code parsing, database schema generation, API route generation, and React component generation
- **Testing:** pytest & HTTPX

### 4. DevOps & Infrastructure (Upcoming/Planned)
- **Containerization:** Docker & Docker Compose
- **Orchestration:** Kubernetes (K8s) for high availability and scaling
- **Infrastructure as Code (IaC):** Terraform for automated cloud provisioning
- **CI/CD:** GitHub Actions for automated testing and deployment

---

## 🚀 Features

- **3D Interactive Wizard:** A step-by-step conversion wizard featuring stunning 3D graphics and smooth animations.
- **User Authentication:** Secure registration and login flows with JWT and password hashing.
- **Asynchronous Processing:** BullMQ safely handles long-running AI conversion tasks without blocking the backend.
- **Comprehensive Testing:** End-to-end testing coverage across the frontend components, backend APIs, and Python worker endpoints.
- **Agentic Workflow:** Employs advanced AI agents that independently read source code, deduce intent, and write full-stack code.
- **Modern UI/UX:** Features a beautiful, dark-themed, glassmorphic UI with loading skeletons, custom 404 pages, and micro-interactions.

---

## 🛠️ Getting Started

### 🐳 Running with Docker (Recommended)

The easiest way to run the entire Agentic Converter platform locally is using Docker. This automatically orchestrates the Frontend, Backend, Python AI Worker, PostgreSQL database, and Redis cache.

**Prerequisites:**
- [Docker](https://www.docker.com/get-started) and Docker Compose installed on your system.

**Steps:**

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd Agentic-Converter
   ```

2. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Open the `.env` file and add your LLM API keys (e.g., `OPENAI_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`).

3. **Build and Start all services:**
   ```bash
   docker compose up -d --build
   ```

4. **Access the Application:**
   - **Frontend UI / Wizard:** [http://localhost:5173](http://localhost:5173)
   - **Backend API:** [http://localhost:5000](http://localhost:5000)
   - **AI Worker API:** [http://localhost:8000](http://localhost:8000)

**Useful Docker Commands:**
- View logs for all services: `docker compose logs -f`
- View logs for a specific service: `docker compose logs -f agentic_worker`
- Stop the application: `docker compose down`

---

### 💻 Local Development Setup (Manual)

If you prefer to run the services directly on your host machine for development:

**Prerequisites**
- Node.js (v20+)
- Python (3.10+)
- PostgreSQL
- Redis
- Prisma CLI

### Installation

1. **Install Frontend Dependencies:**
   ```bash
   cd apps/frontend
   npm install
   ```

2. **Install Backend Dependencies & Database:**
   ```bash
   cd apps/backend
   npm install
   npx prisma generate
   npx prisma db push
   ```

3. **Install Worker Dependencies:**
   ```bash
   cd apps/worker
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

### Running the Project

Start the services locally in separate terminal tabs:

- **Frontend:** `cd apps/frontend && npm run dev`
- **Backend:** `cd apps/backend && npm run dev`
- **Worker:** `cd apps/worker && uvicorn main:app --reload`

---

## 🧪 Testing

The platform includes comprehensive test suites to ensure stability.

- **Frontend Tests:** `npm run test` inside `apps/frontend`
- **Backend Tests:** `npm run test` inside `apps/backend`
- **Worker Tests:** `pytest` inside `apps/worker`

---

## 📄 License
This project is developed as a Final Year Project by Muhammad Hamad. All rights reserved.
