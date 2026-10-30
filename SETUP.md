# Academic Integrity - Setup

Stack: React (frontend) + FastAPI (backend) + MongoDB.

## Backend
cd backend
cp .env.example .env   # fill in values
pip install -r requirements.txt --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

## Frontend
cd frontend
cp .env.example .env
yarn install
yarn start   # http://localhost:3000

Notes:
- All backend routes are prefixed with /api.
- The AI assistant (Claude Sonnet 4.6) uses EMERGENT_LLM_KEY via the emergentintegrations library.
- Google login uses Emergent-managed auth (works on Emergent-hosted domains).
- Test accounts: see memory/test_credentials.md
