// OAuth-прокси GitHub для Decap CMS.
// Секреты: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (wrangler secret put).
// Переменная ALLOWED_ORIGIN — origin сайта с админкой, только ему отдаётся токен.

const STATE_COOKIE = "oauth_state";
const ALLOWED_SCOPES = new Set(["repo", "public_repo"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      return handleAuth(url, env);
    }
    if (url.pathname === "/callback") {
      return handleCallback(request, url, env);
    }
    return new Response("Not found", { status: 404 });
  },
};

function handleAuth(url, env) {
  const scope = ALLOWED_SCOPES.has(url.searchParams.get("scope"))
    ? url.searchParams.get("scope")
    : "repo";
  const state = crypto.randomUUID();

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", url.origin + "/callback");
  authorize.searchParams.set("scope", scope);
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function handleCallback(request, url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = readCookie(request.headers.get("Cookie"), STATE_COOKIE);

  if (!code || !state || state !== savedState) {
    return resultPage(env, "error", { message: "Неверный state или отсутствует code" });
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "bh-menu-oauth",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: url.origin + "/callback",
    }),
  });

  const data = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !data.access_token) {
    return resultPage(env, "error", {
      message: data.error_description || data.error || "Не удалось получить токен",
    });
  }

  return resultPage(env, "success", { token: data.access_token, provider: "github" });
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

// Протокол Decap: окно шлёт "authorizing:github", CMS отвечает,
// после чего окно отправляет результат в ответивший origin.
function resultPage(env, status, payload) {
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;
  // Экранирование "<", чтобы токен/текст ошибки не закрыли тег <script>
  const messageJs = JSON.stringify(message).replace(/</g, "\\u003c");
  const originJs = JSON.stringify(env.ALLOWED_ORIGIN || "").replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Авторизация</title></head>
<body>
<p>Авторизация… Окно закроется автоматически.</p>
<script>
(function () {
  var allowedOrigin = ${originJs};
  var message = ${messageJs};
  if (!window.opener) {
    document.body.textContent = "Откройте вход из админки сайта.";
    return;
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== allowedOrigin) return;
    window.opener.postMessage(message, e.origin);
    setTimeout(function () { window.close(); }, 300);
  }, false);
  window.opener.postMessage("authorizing:github", allowedOrigin);
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: status === "success" ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
