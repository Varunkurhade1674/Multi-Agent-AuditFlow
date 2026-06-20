# backend/main.py
import os
import json
import asyncio
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, File, UploadFile
# pyrefly: ignore [missing-import]
from fastapi.responses import StreamingResponse
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from dotenv import load_dotenv

# Load .env from the current working directory. If keys are not found,
# also attempt to load a .env from the project root (parent directory).
load_dotenv()

# If no API key found in current env, try loading parent .env (project root)
if not (os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")):
    parent_env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(parent_env):
        load_dotenv(parent_env, override=False)

# Import directly from the octochains package 
from octochains.base import Agent
from octochains.engine import Engine
from octochains.aggregators import ConflictChecker

# pyrefly: ignore [missing-import]
from utils.document_parser import parse_pdf_to_sentences
# pyrefly: ignore [missing-import]
from prompts import FINANCE_PROMPT, LEGAL_PROMPT, OPS_PROMPT, LEASE_DUE_DILIGENCE_GOAL

app = FastAPI(title="Multi-Agent AuditFlow – Parallel Expert Analysis")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SERVE FRONTEND STATIC FILES ---
base_dir = os.path.dirname(os.path.abspath(__file__))
frontend_dir = os.path.join(base_dir, "..", "frontend")
app.mount("/frontend", StaticFiles(directory=frontend_dir), name="frontend")

# pyrefly: ignore [missing-import]
from fastapi.responses import RedirectResponse

@app.get("/")
async def root():
    return RedirectResponse(url="/frontend/index.html?v=4")


current_document_context = []

# Synchronous client wrapper for Groq via OpenAI library
# Prefer OPENAI_API_KEY when both keys exist. Fall back to GROQ if only GROQ is set.
openai_key = os.getenv("OPENAI_API_KEY")
groq_key = os.getenv("GROQ_API_KEY")
selected_api_key = openai_key or groq_key
if not selected_api_key:
    raise RuntimeError("No API key found. Set OPENAI_API_KEY or GROQ_API_KEY in your environment or .env file.")

if openai_key:
    openai_client = OpenAI(api_key=openai_key, base_url="https://api.openai.com/v1")
    provider_name = "OpenAI"
else:
    openai_client = OpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
    provider_name = "Groq"

# --- LLM CALLABLES ---

import time
import random

def retry_llm(func):
    def wrapper(*args, **kwargs):
        for attempt in range(6):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "503" in err_str:
                    print(f"Rate limit hit. Retrying attempt {attempt+1}... ({err_str[:50]})")
                    time.sleep(2 + attempt * 2 + random.uniform(0, 1))
                else:
                    raise e
        raise Exception("API Rate Limit Exhausted after retries.")
    return wrapper

@retry_llm
def call_openai_aggregator(prompt: str) -> str:
    """Callable for the Central Aggregator (The Reduce Phase)."""
    model_name = os.getenv("LLM_MODEL", "gpt-4o")
    response = openai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": "You are the Chief Justice. Analyze the reports and output a structured JSON conflict audit."},
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"},
        temperature=0.1
    )
    return response.choices[0].message.content

@retry_llm
def call_openai_agent(prompt: str) -> str:
    """Callable for the Isolated Specialists (The Map Phase)."""
    model_name = os.getenv("LLM_MODEL", "gpt-4o")
    response = openai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"},
        temperature=0.1
    )
    return response.choices[0].message.content


# --- AGENT WRAPPERS ---
def parse_agent_response(raw_result, agent_name, color):
    if isinstance(raw_result, str):
        try:
            clean_str = raw_result.strip().removeprefix("```json").removesuffix("```").strip()
            parsed_result = json.loads(clean_str)
        except json.JSONDecodeError:
            parsed_result = {"selected_sentence_ids": [], "insight": "Failed to extract structured data."}
    else:
        parsed_result = raw_result

    return {
        "agent": agent_name,
        "color": color,
        "selected_sentence_ids": parsed_result.get("selected_sentence_ids", []),
        "insight": parsed_result.get("insight", "")
    }

class ExpertAgent(Agent):
    """Refactored agent class utilizing the Bring-Your-Own-LLM callable pattern."""
    def __init__(self, role: str, goal: str, color: str, system_prompt: str, llm_callable):
        super().__init__(role=role, goal=goal)
        self.color = color
        self.system_prompt = system_prompt
        self.llm_callable = llm_callable
        
    def execute(self, problem_data: str):
        # Construct the isolated prompt for the specialist
        prompt = f"{self.system_prompt}\n\nAnalyze the following data:\n{problem_data}"
        
        # Execute via the standard callable
        return self.llm_callable(prompt)


# --- API ROUTES ---
@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    global current_document_context
    file_bytes = await file.read()
    
    sentence_objects = parse_pdf_to_sentences(file_bytes)
    current_document_context = sentence_objects
    
    return {"status": "success", "sentences": sentence_objects}


async def run_octochains_stream():
    global current_document_context
    yield f"data: {json.dumps({'status': 'engine_started', 'message': f'Booting thread-isolated experts via {provider_name}...'})}\n\n"
    
    # 1. Initialize Agents with the OpenAI callable
    finance = ExpertAgent(
        role="Finance Agent",
        goal="Identify financial risks and liabilities.",
        color="#FFD54D",
        system_prompt=FINANCE_PROMPT,
        llm_callable=call_openai_agent
    )
    legal = ExpertAgent(
        role="Legal Agent",
        goal="Identify legal traps and governance limitations.",
        color="#00BEBE",
        system_prompt=LEGAL_PROMPT,
        llm_callable=call_openai_agent
    )
    ops = ExpertAgent(
        role="Operations Agent",
        goal="Identify operational bottlenecks and maintenance burdens.",
        color="#00A15E",
        system_prompt=OPS_PROMPT,
        llm_callable=call_openai_agent
    )
    
    agents = [finance, legal, ops]
    agent_color_map = {agent.role: agent.color for agent in agents}
    
    # 2. Instantiate the Native Aggregator
    boss = ConflictChecker(
        llm_callable=call_openai_aggregator, 
        pairwise_audit=True,
        custom_goal=LEASE_DUE_DILIGENCE_GOAL,
        max_threads=3,
        show_log=True
    )
    
    # 3. Mount everything directly to the Engine
    engine = Engine(agents=agents, aggregator=boss)
    
    # 4. Fire the complete execution pipeline
    document_payload = json.dumps(current_document_context)
    
    loop = asyncio.get_running_loop()
    execution_results = await loop.run_in_executor(None, engine.run, document_payload, True)
    
    # 5. Extract results out of the Report traces to stream cleanly to the UI
    for trace in execution_results.traces:
        color = agent_color_map.get(trace.agent_role, "#FFFFFF")
        
        # Determine the raw output based on the trace state
        raw_output = trace.output if trace.status == "success" else {"insight": f"Error: {trace.error_message}"}
        formatted_report = parse_agent_response(raw_output, trace.agent_role, color)
        
        yield f"data: {json.dumps({'status': 'agent_report', 'data': formatted_report})}\n\n"
        await asyncio.sleep(0.3)
        
    # 6. Pull the final aggregated output from the engine state
    yield f"data: {json.dumps({'status': 'aggregator_started', 'message': 'Compiling cross-domain conflict analysis...'})}\n\n"
    await asyncio.sleep(0.2)
    
    aggregated_report = execution_results.consensus
    
    # Handle object conversion if the aggregator returned a structured Pydantic object
    if hasattr(aggregated_report, 'model_dump'):
        aggregated_report = aggregated_report.model_dump()
    elif isinstance(aggregated_report, str):
        try:
            aggregated_report = json.loads(aggregated_report)
        except json.JSONDecodeError:
            pass

    yield f"data: {json.dumps({'status': 'conflict_report', 'data': aggregated_report})}\n\n"
    yield f"data: {json.dumps({'status': 'complete'})}\n\n"


@app.get("/api/analyze")
async def analyze_document():
    return StreamingResponse(run_octochains_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)