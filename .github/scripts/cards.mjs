// Renders the profile's stats and top-languages cards as SVG from public GitHub data.
// Runs daily in GitHub Actions with the built-in GITHUB_TOKEN, so the README never depends on
// a third-party card service. Writes profile/stats.svg and profile/languages.svg.
import { mkdirSync, writeFileSync } from 'node:fs';

const LOGIN = process.env.PROFILE_LOGIN || 'kon2raya24';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const THEME = { bg: '#141321', title: '#fe428e', text: '#a9fef7', accent: '#f8d847', muted: '#7d7a9c', ring: '#2a2940' };
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': `${LOGIN}-profile-cards` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => n.toLocaleString('en-US');

async function collect() {
  const { user } = await gql(`query($login: String!) {
    user(login: $login) {
      name
      followers { totalCount }
      contributionsCollection { totalCommitContributions contributionCalendar { totalContributions } }
      pullRequests { totalCount }
      repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST], includeUserRepositories: false) { totalCount }
    }
  }`, { login: LOGIN });
  let after = null, repos = 0, stars = 0;
  const bytes = new Map();
  do {
    const { user: u } = await gql(`query($login: String!, $after: String) {
      user(login: $login) {
        repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { stargazerCount languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } } }
        }
      }
    }`, { login: LOGIN, after });
    const page = u.repositories;
    repos = page.totalCount;
    for (const r of page.nodes) {
      stars += r.stargazerCount;
      for (const e of r.languages.edges) {
        const cur = bytes.get(e.node.name) || { size: 0, color: e.node.color || THEME.muted };
        cur.size += e.size;
        bytes.set(e.node.name, cur);
      }
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return {
    name: user.name || LOGIN,
    followers: user.followers.totalCount,
    contributions: user.contributionsCollection.contributionCalendar.totalContributions,
    commits: user.contributionsCollection.totalCommitContributions,
    prs: user.pullRequests.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
    repos,
    stars,
    languages: [...bytes.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size),
  };
}

function statsCard(s) {
  const rows = [
    ['Contributions (last year)', s.contributions],
    ['Commits (last year)', s.commits],
    ['Pull requests', s.prs],
    ['Public repositories', s.repos],
    ['Contributed to (other repos)', s.contributedTo],
  ];
  if (s.stars > 0) rows.push(['Stars earned', s.stars]);
  const h = 70 + rows.length * 25 + 10;
  const body = rows.map(([label, value], i) => `
    <g transform="translate(25, ${72 + i * 25})">
      <circle cx="5" cy="-5" r="4" fill="${THEME.accent}"/>
      <text x="18" y="0" fill="${THEME.text}" font-size="14" font-family="${FONT}">${esc(label)}:</text>
      <text x="245" y="0" fill="${THEME.text}" font-size="14" font-weight="700" font-family="${FONT}">${fmt(value)}</text>
    </g>`).join('');
  const cy = Math.round(h / 2) + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="${h}" viewBox="0 0 495 ${h}" role="img" aria-labelledby="title desc">
  <title id="title">${esc(s.name)}'s GitHub stats</title>
  <desc id="desc">${rows.map(([l, v]) => `${esc(l)}: ${fmt(v)}`).join('; ')}</desc>
  <rect width="495" height="${h}" rx="6" fill="${THEME.bg}"/>
  <text x="25" y="38" fill="${THEME.title}" font-size="18" font-weight="600" font-family="${FONT}">${esc(s.name)}'s GitHub Stats</text>${body}
  <g transform="translate(415, ${cy})">
    <circle r="45" fill="none" stroke="${THEME.ring}" stroke-width="7"/>
    <circle r="45" fill="none" stroke="${THEME.title}" stroke-width="7" stroke-dasharray="283" stroke-dashoffset="0" opacity="0.85"/>
    <text y="4" text-anchor="middle" fill="${THEME.text}" font-size="20" font-weight="700" font-family="${FONT}">${fmt(s.contributions)}</text>
    <text y="22" text-anchor="middle" fill="${THEME.muted}" font-size="10" font-family="${FONT}">this year</text>
  </g>
</svg>
`;
}

function languagesCard(langs) {
  const top = langs.slice(0, 8);
  const total = top.reduce((n, l) => n + l.size, 0) || 1;
  let x = 25;
  const bar = top.map((l) => {
    const w = (l.size / total) * 300;
    const seg = `<rect x="${x.toFixed(2)}" y="52" width="${Math.max(w, 0.5).toFixed(2)}" height="8" fill="${l.color}"/>`;
    x += w;
    return seg;
  }).join('');
  const legend = top.map((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const pct = ((l.size / total) * 100).toFixed(1);
    return `<g transform="translate(${25 + col * 150}, ${84 + row * 22})"><circle cx="5" cy="-4" r="5" fill="${l.color}"/><text x="16" y="0" fill="${THEME.text}" font-size="12" font-family="${FONT}">${esc(l.name)} ${pct}%</text></g>`;
  }).join('');
  const h = 84 + Math.ceil(top.length / 2) * 22 + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="${h}" viewBox="0 0 350 ${h}" role="img" aria-labelledby="title desc">
  <title id="title">Most used languages</title>
  <desc id="desc">${top.map((l) => `${esc(l.name)} ${((l.size / total) * 100).toFixed(1)}%`).join(', ')} (by code size across public repositories)</desc>
  <rect width="350" height="${h}" rx="6" fill="${THEME.bg}"/>
  <text x="25" y="36" fill="${THEME.title}" font-size="18" font-weight="600" font-family="${FONT}">Most Used Languages</text>
  <clipPath id="bar"><rect x="25" y="52" width="300" height="8" rx="4"/></clipPath>
  <g clip-path="url(#bar)">${bar}</g>${legend}
</svg>
`;
}

const stats = await collect();
mkdirSync('profile', { recursive: true });
writeFileSync('profile/stats.svg', statsCard(stats));
writeFileSync('profile/languages.svg', languagesCard(stats.languages));
console.log(`cards written: ${stats.repos} repos, ${stats.contributions} contributions, top language ${stats.languages[0]?.name}`);
