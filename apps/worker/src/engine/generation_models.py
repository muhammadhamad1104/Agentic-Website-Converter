from pydantic import BaseModel, Field

class FileContent(BaseModel):
    filename: str = Field(..., description="The relative file path, e.g., 'src/index.js' or 'components/App.tsx'")
    code: str = Field(..., description="The actual source code for this file")

class BackendArtifact(BaseModel):
    endpoints: list[FileContent] = Field(..., description="Express route controllers for each entity")
    models: list[FileContent] = Field(..., description="Prisma schema file and any backend models")
    health_check: FileContent = Field(..., description="Health check endpoint implementation")
    auth_middleware: FileContent | None = Field(default=None, description="Authentication middleware if applicable")
    server_entry: FileContent = Field(..., description="Main server entrypoint (e.g. server.ts or index.js)")
    package_json: FileContent = Field(..., description="package.json for backend dependencies")
    seed_script: FileContent | None = Field(default=None, description="Optional Node.js script (e.g. seed.js) that uses Prisma Client to insert the provided sample scraped data into the database")

class FrontendArtifact(BaseModel):
    pages: list[FileContent] = Field(..., description="React page components for each entity")
    router: FileContent = Field(..., description="React Router configuration file")
    components: list[FileContent] = Field(..., description="Reusable React UI components")
    styles: list[FileContent] = Field(..., description="Global styles or CSS modules")
    package_json: FileContent = Field(..., description="package.json for frontend dependencies")
    index_html: FileContent | None = Field(default=None, description="index.html entry point for Vite")
    main_entry: FileContent | None = Field(default=None, description="main.jsx React entry point")

class AdminArtifact(BaseModel):
    resources: list[FileContent] = Field(..., description="Admin resource views for each entity")
    dashboard: FileContent = Field(..., description="Admin dashboard view")
    auth_guard: FileContent = Field(..., description="Admin authentication guard component")
    crud_views: list[FileContent] = Field(..., description="Shared CRUD view components")

class GeneratedDeployment(BaseModel):
    health_endpoint: str = Field(default="/health", description="The endpoint for health checks")
    backend_start_command: str = Field(default="npm run start", description="Command to start backend")
    frontend_build_command: str = Field(default="npm run build", description="Command to build frontend")
    frontend_preview_command: str = Field(default="npm run preview", description="Command to preview frontend")
    backend_runtime: str = Field(default="node>=18", description="Backend runtime required")

class FullStackArtifact(BaseModel):
    backend: BackendArtifact = Field(..., description="The generated backend application")
    frontend: FrontendArtifact = Field(..., description="The generated frontend application")
    admin: AdminArtifact = Field(..., description="The generated admin portal application")
    deployment: GeneratedDeployment = Field(default_factory=GeneratedDeployment, description="Deployment configuration")
