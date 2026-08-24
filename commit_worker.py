import os
import subprocess
import random

def run_cmd(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error running: {cmd}\n{result.stderr}")
    return result.stdout.strip()

# Get untracked files
with open("/tmp/worker_files.txt", "r") as f:
    all_files = [line.strip() for line in f if line.strip()]

all_files.sort()

chunk_size = 10
chunks = [all_files[i:i + chunk_size] for i in range(0, len(all_files), chunk_size)]

verbs = ["Add", "Implement", "Update", "Setup"]

for i, chunk in enumerate(chunks):
    verb = random.choice(verbs)
    msg = f"{verb} AI worker files"
    
    # Add files
    for f in chunk:
        run_cmd(f"git add \"{f}\"")
    
    # Commit
    run_cmd(f"git commit -m \"{msg}\"")
    print(f"Committed chunk {i+1}/{len(chunks)} with message: {msg}")

# Push all to remote
print("Pushing to GitHub...")
push_res = run_cmd("git push -u origin main")
print(push_res)
print("Finished worker push!")
