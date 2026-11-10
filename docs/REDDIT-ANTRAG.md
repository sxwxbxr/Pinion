# Reddit-API-Antrag (Entwurf)

**Wo:** Reddit verlangt seit Nov. 2025 eine Freigabe nach der *Responsible Builder Policy*. Den Antrag stellst du über das Formular, das auf [reddit.com/wiki/api](https://www.reddit.com/wiki/api) bzw. im Reddit Help Center unter „Developer Platform & Accessing Reddit Data“ verlinkt ist. Die Felder heissen dort leicht anders. Die Texte unten passen auf die üblichen Fragen.

**Vorher:** Den Reddit-Account, den du verbinden willst, eine Weile normal von Hand nutzen (Karma, Alter). Neue, leere Accounts werden oft abgelehnt.

Alles in `<…>` ersetzen. Die Texte auf Englisch lassen, das Formular ist englisch.

---

**App name:** `<Produktname>` (self-hosted, personal use)

**Type of use:** Personal / non-commercial. One person, one Reddit account (my own).

**Reddit username:** u/`<dein_username>`

**Describe your use case:**
> I'm an independent software developer (`<sweber.dev>`). I'm building a small self-hosted tool that runs on a Raspberry Pi at my home. It helps me plan my own posts across several networks and keep track of replies to them. For Reddit it will:
>
> 1. Submit my own posts to a few subreddits where I'm already an active member and where self-promotion is allowed under the subreddit rules (e.g. `<r/SideProject>`, `<r/selfhosted>`). At most one post per day, usually far fewer.
> 2. Read the comments on my own posts so I see them in one inbox.
> 3. Post replies to comments on my own posts.
>
> Every post and every reply is drafted first and only goes out after I approve it manually. Nothing is published without me.

**What the app will NOT do:**
> No voting, no following, no private messages or chat, no commenting on other people's posts found by keyword search, no scraping of subreddits or users, no reposting the same content to several subreddits, no multiple accounts. There is no data resale and no use of Reddit data for AI model training.

**Data handling:**
> The only data stored is my own posts, the comments on them, and my OAuth tokens (AES-256-GCM encrypted, local SQLite on my own device). Nothing is shared with third parties. Deleted content is removed from the local database on the next sync.

**Expected volume:**
> Under 100 API requests per day. Polling of my own posts' comments every 15 minutes for posts from the last 7 days.

**OAuth scopes:** `identity`, `submit`, `read`

**Redirect URI:** `http://localhost:8787/callback/reddit`

**User agent:** `web:<produktname>:v0.2.0 (by /u/<dein_username>)`

**Source code:** `<https://github.com/sxwxbxr/…>` (open source, public)

---

Nach der Freigabe: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` und `REDDIT_USER_AGENT` in `/opt/reachpilot/.env` eintragen, dann `reachpilot connect` → reddit.
