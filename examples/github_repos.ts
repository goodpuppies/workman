type Repo = {
  name: string;
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  html_url: string;
};

const defaultUser = "denoland";
const perPage = 5;
const sort = "updated";
const user = Deno.args[0] ?? defaultUser;
const api = `https://api.github.com/users/${encodeURIComponent(user)}/repos?sort=${sort}&per_page=${perPage}`;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }
  return await response.json() as T;
}

function describe(repo: Repo): string {
  const stars = repo.stargazers_count;
  const forks = repo.forks_count;
  const issues = repo.open_issues_count;
  return [
    `${repo.full_name}`,
    `  stars ${stars}, forks ${forks}, open issues ${issues}`,
    `  ${repo.html_url}`,
  ].join("\n");
}

function render(user: string, repos: Repo[]): string {
  const totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const heading = `Recent ${user} repos (${repos.length}, ${totalStars} stars shown)`;
  const body = repos.map(describe).join("\n\n");
  return `${heading}\n${"=".repeat(heading.length)}\n\n${body}`;
}

if (import.meta.main) {
  try {
    const repos = await fetchJson<Repo[]>(api);
    console.log(render(user, repos));
  } catch (error) {
    console.error(`github example failed: ${error}`);
    Deno.exit(1);
  }
}
