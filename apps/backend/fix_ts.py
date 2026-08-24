import os
import re

express_import = "import { Request, Response, NextFunction } from 'express';\n"
jwt_secret = "process.env.JWT_SECRET as string"

for root, _, files in os.walk('src'):
    for file in files:
        if not file.endswith('.ts'):
            continue
        filepath = os.path.join(root, file)
        with open(filepath, 'r') as f:
            content = f.read()

        changed = False

        if 'req, res, next' in content or '(req, res)' in content:
            if 'import { Request' not in content:
                content = express_import + content
                changed = True
            
            content = re.sub(r'\((req), (res), (next)\)', r'(req: Request, res: Response, next: NextFunction)', content)
            content = re.sub(r'\((req), (res)\)', r'(req: Request, res: Response)', content)
            content = re.sub(r'\(err, req: Request, res: Response, next: NextFunction\)', r'(err: any, req: Request, res: Response, next: NextFunction)', content)
            changed = True

        if 'process.env.JWT_SECRET' in content and 'as string' not in content:
            content = content.replace('process.env.JWT_SECRET,', jwt_secret + ',')
            changed = True
            
        if 'import.meta.url' in content:
            content = content.replace('import.meta.url', '"file://" + __filename')
            changed = True

        if changed:
            with open(filepath, 'w') as f:
                f.write(content)
