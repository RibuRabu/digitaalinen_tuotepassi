export interface Env {
  DB: D1Database;
  ADMIN_SECRET: string;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init?.headers,
    },
  });
}

function readAdminSecret(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return request.headers.get("x-admin-secret");
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const providedSecret = readAdminSecret(request);
  return Boolean(env.ADMIN_SECRET && providedSecret === env.ADMIN_SECRET);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "digitaalinen_tuotepassi" });
    }

    if (url.pathname === "/api/products" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, product_name, created_at FROM products ORDER BY created_at DESC LIMIT 50",
      ).all();

      return jsonResponse({ products: results });
    }

    if (url.pathname === "/api/admin/product/create" && request.method === "POST") {
      if (!isAuthorizedAdmin(request, env)) {
        return jsonResponse({ error: "Unauthorized." }, { status: 401 });
      }

      const payload = (await request.json()) as {
        product_name?: string;
      };

      if (!payload.product_name) {
        return jsonResponse(
          { error: "Field product_name is required." },
          { status: 400 },
        );
      }

      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO products (id, product_name) VALUES (?, ?)",
      )
        .bind(id, payload.product_name)
        .run();

      return jsonResponse({ id, product_name: payload.product_name }, { status: 201 });
    }

    return jsonResponse(
      {
        name: "digitaalinen_tuotepassi",
        endpoints: [
          "GET /health",
          "GET /api/products",
          "POST /api/admin/product/create",
        ],
      },
      { status: 200 },
    );
  },
};
