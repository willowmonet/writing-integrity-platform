# Going live for free: GitHub Pages + Render + MongoDB Atlas

- **Frontend** → GitHub Pages: https://willowmonet.github.io/writing-integrity-platform/
- **Backend** → Render (free web service)
- **Database** → MongoDB Atlas (free M0 cluster)

Your repo root should contain: `.github/`, `backend/`, `frontend/`, `render.yaml`, `DEPLOY.md`.
(`.github` is a hidden folder. If you upload through the GitHub website, drag the whole folder in,
or create the file `.github/workflows/deploy-pages.yml` with **Add file → Create new file**.)

---

## Step 1: Free database (MongoDB Atlas)
1. Sign up at https://www.mongodb.com/cloud/atlas/register and create a **free M0** cluster.
2. **Database Access** → add a user and password.
3. **Network Access** → add IP `0.0.0.0/0` (lets Render connect).
4. **Connect → Drivers** → copy the connection string, e.g.
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## Step 2: Free backend (Render)
1. Sign up at https://render.com with your GitHub account.
2. **New → Blueprint** → pick the `writing-integrity-platform` repo. Render reads `render.yaml`.
3. When asked, fill in:
   - `MONGO_URL` = the Atlas string from Step 1
   - `EMERGENT_LLM_KEY` = your Emergent Universal Key (Emergent → Profile → Universal Key)
4. Deploy. Copy the service URL, e.g. `https://writing-integrity-backend.onrender.com`.
5. Check it: open `https://<your-service>.onrender.com/api/`. You should see `{"status":"ok",...}`.

Note: free Render services go to sleep after 15 minutes of no traffic. The first request after that can take about 50 seconds.

## Step 3: Point the frontend at the backend
1. In GitHub: repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**
   - Name: `REACT_APP_BACKEND_URL`
   - Value: your Render URL (no trailing slash), e.g. `https://writing-integrity-backend.onrender.com`
2. Repo → **Settings → Pages** → **Source: GitHub Actions**.
3. Repo → **Actions** → "Deploy frontend to GitHub Pages" → **Run workflow** (it also runs on every push to `main`).
4. When it finishes, open https://willowmonet.github.io/writing-integrity-platform/

## How it fits together
- The site is built with `PUBLIC_URL=/writing-integrity-platform`, so pages and links work under the repo path.
- `404.html` is a copy of `index.html`, so refreshing a deep link (e.g. `/editor/...`) still loads the app.
- Login keeps a session token in the browser and sends it as `Authorization: Bearer`. This works even when the browser blocks third-party cookies.
- `CORS_ORIGINS` in `render.yaml` allows only `https://willowmonet.github.io`.

## Troubleshooting
- **Page says 404**: Settings → Pages source must be **GitHub Actions**, and the workflow must have run successfully.
- **Blank page / login loops**: check the `REACT_APP_BACKEND_URL` variable, then re-run the workflow (the value is baked in at build time).
- **"Network Error"**: the Render service is waking up (wait about 1 minute), or `CORS_ORIGINS` is wrong.
- **AI assistant errors**: check `EMERGENT_LLM_KEY` on Render and your Universal Key balance.
