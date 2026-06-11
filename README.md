# Clinic Management App

## Deploy to GitHub Pages (3 steps)

### 1. Push to GitHub
Create a new repo on GitHub, then:
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

### 2. Build and deploy
```bash
npm install
npm run deploy
```

### 3. Enable GitHub Pages
Go to your repo → Settings → Pages → Source: **Deploy from a branch** → Branch: **gh-pages** → Save

Your app will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

---
No backend needed. The app connects directly to Supabase.
