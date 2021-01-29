import { createWriteStream } from "fs";
import Koa from "koa";
import jsonwebtoken from "jsonwebtoken";
import KoaJWT from "koa-jwt";
import Router from "koa-better-router";
import BodyParser from "koa-bodyparser";
import { Category, Meter, Note } from "konsum-db";
import { authenticate } from "./auth.mjs";

export const defaultHttpServerConfig = {
  http: {
    port: "${first(env.PORT,12345)}"
  }
};

function setNoCacheHeaders(ctx) {
  ctx.set("Cache-Control", "no-store, no-cache, must-revalidate");
  ctx.set("Pragma", "no-cache");
  ctx.set("Expires", 0);
}

function enshureEntitlement(ctx, entitlement) {
  const user = ctx.state.user;

  if (user) {
    if (user.entitlements.indexOf(entitlement) >= 0) {
      return true;
    }
  }

  ctx.throw(403, `missing ${entitlement}`);
}

function isTrue(v) {
  return v && v !== "false" && v != "0";
}

/**
 * Recode duration string into seconds.
 * 2h -> 7200
 * @param {string} duration
 * @returns {number} seconds
 */
function durationAsSeconds(duration) {
  if (duration) {
    const m = duration.match(/^(\d+)(\w+)/);

    if (m) {
      const n2s = { m: 60, h: 3600 };
      const unitName = m[2];
      if (n2s[unitName]) {
        return n2s[unitName] * parseInt(m[1]);
      }
    }
  }

  return 0;
}


export async function prepareHttpServer(config, sd, master) {
  const app = new Koa();
  const router = Router();

  // middleware to restrict access to token holding requests
  const restricted = KoaJWT({
    secret: config.auth.jwt.public,
    audience: config.auth.jwt.audience
  });

  function shutdown() {
    sd.notify("STOPPING=1\nSTATUS=stopping");
    server.unref();
  }

  process.on("SIGINT", () => shutdown());

  /**
   * @swagger
   *
   * /admin/stop:
   *   post:
   *     operationId: stopServer
   *     description: Stop konsum server.
   *     responses:
   *       '200':
   *         description: Progress message.
   *         content:
   *           application/text:
   *             schema:
   *               $ref: '#/components/schemas/TextOnlyMessage'
   */
  router.addRoute("POST", "/admin/stop", async (ctx, next) => {
    enshureEntitlement(ctx, "konsum.admin.stop");
    shutdown();
    ctx.body = "stopping...";
    return next();
  });

  /**
   * @swagger
   *
   * /admin/reload:
   *   post:
   *     operationId: reloadConfig
   *     description: Reload konsum systemd config.
   *     responses:
   *       '200':
   *         description: Progress message.
   *         content:
   *           application/text:
   *             schema:
   *               $ref: '#/components/schemas/TextOnlyMessage'
   */
  router.addRoute("POST", "/admin/reload", async (ctx, next) => {
    enshureEntitlement(ctx, "konsum.admin.reload");
    sd.notify("RELOADING=1");
    // TODO
    return next();
  });

  /**
   * @swagger
   *
   * /admin/backup:
   *   post:
   *     operationId: backupDataOnServer
   *     description: Create backup on server.
   *     responses:
   *       '200':
   *         description: Success message. 
   *         content:
   *           application/text:
   *             schema:
   *               $ref: '#/components/schemas/TextOnlyMessage'
   */
  router.addRoute(
    "POST",
    "/admin/backup",
    restricted,
    BodyParser(),
    async (ctx, next) => {
      enshureEntitlement(ctx, "konsum.admin.backup");

      const q = ctx.request.body;
      const name = q.filename || "/tmp/konsum.txt";

      ctx.body = `backup to ${name}...`;

      master.backup(createWriteStream(name, { encoding: "utf8" }));
      return next();
    }
  );

  /**
   * @swagger
   *
   * /admin/backup:
   *   get:
   *     operationId: backupData
   *     description: Create backup.
   *     responses:
   *       '200':
   *         description: Backup data as text.
   *         content:
   *           application/text:
   *             schema:
   *               $ref: '#/components/schemas/TextOnlyMessage'
   */
  router.addRoute("GET", "/admin/backup", restricted, async (ctx, next) => {
    enshureEntitlement(ctx, "konsum.admin.backup");

    ctx.response.set("content-type", "text/plain");
    ctx.response.set(
      "Content-Disposition",
      'attachment; filename="konsum_backup.txt"'
    );
    ctx.status = 200;
    ctx.respond = false;
    await master.backup(ctx.res);
    ctx.res.end();
    return next();
  });

  /**
   * @swagger
   *
   * /state:
   *   get:
   *     operationId: getServiceState 
   *     description: Retrieve service state.
   *     responses:
   *       '200':
   *         description: Service state.
   *         content:
   *           application/json:
   *             schema:
   *               items:
   *                 $ref: '#/components/schemas/State'
   */
  router.addRoute("GET", "/state", async (ctx, next) => {
    setNoCacheHeaders(ctx);

    ctx.body = {
      version: config.version,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };

    return next();
  });

  /**
   * Authenticate.
   * @swagger
   *
   * /authenticate:
   *   tags:
   *     - authenticate
   *   post:
   *     operationId: authenticate
   *     description: Login to request api token.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AuthRequest'
   *     responses:
   *       '200':
   *         description: Token generated.
   *         content:
   *           'application/json':
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       '401':
   *         description: Authentication failed.
   *         content:
   *           'application/text':
   *             schema:
   *               $ref: '#/components/schemas/TextOnlyMessage'
   */
  router.addRoute("POST", "/authenticate", BodyParser(), async (ctx, next) => {
    const q = ctx.request.body;

    const { entitlements } = await authenticate(config, q.username, q.password);

    if (entitlements.has("konsum")) {
      const claims = {
        name: q.username,
        entitlements: [...entitlements].join(",")
      };
      if (config.auth.jwt.audience) {
        claims.audience = config.auth.jwt.audience;
      }

      const access_token = jsonwebtoken.sign(
        claims,
        config.auth.jwt.private,
        config.auth.jwt.options
      );

      const refresh_token = jsonwebtoken.sign(
        {},
        config.auth.jwt.private,
        config.auth.jwt.options
      );

      ctx.status = 200;
      ctx.body = {
        access_token,
        refresh_token,
        token_type: "bearer",
        expires: durationAsSeconds(config.auth.jwt.options.expiresIn)
      };
    } else {
      ctx.throw(401, "Authentication failed");
    }
    return next();
  });

  app.use(router.middleware());

  /**
   * Retrieve list of categories
   * @swagger
   * /category:
   *   tags:
   *     - category
   *   get:
   *     operationId: getCategories
   *     summary: Retrieve list of categories.
   *     responses:
   *       '200':
   *         description: A list of categories.
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Category'
   *   security:
   *     - konsum_auth:
   *       - konsum.category
   */
  router.addRoute("GET", "/category", restricted, async (ctx, next) => {
    setNoCacheHeaders(ctx);
    const cs = [];

    for await (const c of Category.entries(master.db)) {
      cs.push(c.toJSON());
    }

    ctx.body = cs;
    return next();
  });

  /**
   * @swagger
   *
   * /category/{category}:
   *   parameters:
   *   - $ref: '#/components/parameters/category'
   *   put:
   *     operationId: addCategory
   *     description: Add a new category.
   *     responses:
   *       '200':
   *         description: success message.
   *         content:
   *           'application/json':
   *             schema:
   *               $ref: '#/components/schemas/Message'
   *   security:
   *     - konsum_auth:
   *       - konsum.category.add
   */
  router.addRoute(
    "PUT",
    "/category/:category",
    restricted,
    BodyParser(),
    async (ctx, next) => {
      enshureEntitlement(ctx, "konsum.category.add");

      const category = new Category(
        ctx.params.category,
        master,
        ctx.request.body
      );
      await category.write(master.db);
      ctx.body = { message: "updated" };
      return next();
    }
  );

  /**
   * @swagger
   *
   * /category/{category}:
   *   parameters:
   *   - $ref: '#/components/parameters/category'
   *   delete:
   *     operationId: deleteCategory
   *     description: Delete a category.
   *     responses:
   *       '200':
   *         description: success message.
   *         content:
   *           'application/json':
   *             schema:
   *               $ref: '#/components/schemas/Message'
   *       '404':
   *         description: No such category error message.
   *         content:
   *           'application/json':
   *             schema:
   *               $ref: '#/components/schemas/Message'
   *   security:
   *     - konsum_auth:
   *       - konsum.category.delete
   */
  router.addRoute(
    "DELETE",
    "/category/:category",
    restricted,
    async (ctx, next) => {
      enshureEntitlement(ctx, "konsum.category.delete");

      const c = await Category.entry(master.db, ctx.params.category);
      if (c) {
        await c.delete(master.db);
        ctx.body = { message: "deleted" };
      } else {
        ctx.throw(404, "No such category");
      }
      return next();
    }
  );

  /**
   * @swagger
   *
   * /category/{category}/value:
   *   parameters:
   *   - $ref: '#/components/parameters/category'
   *   - name: limit
   *     in: query
   *     description: Limits the number of entries delivered.
   *     required: false
   *     default: 10
   *     schema:
   *       type: integer
   *   - name: reverse
   *     in: query
   *     description: Reverses the order in which the entries are delivered.
   *     required: false
   *     default: false
   *     schema:
   *       type: boolean
   *   get:
   *     operationId: getCategoryValues
   *     description: List values of a category.
   *     responses:
   *       '200':
   *         description: Value list.
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Value'
   *       '406':
   *         description: Unsupported content-type.
   *         content:
   *           'text': "json, or text only"
   */
  router.addRoute(
    "GET",
    "/category/:category/value",
    restricted,
    async (ctx, next) => {
      setNoCacheHeaders(ctx);

      const reverse = isTrue(ctx.query.reverse);
      const limit =
        ctx.query.limit === undefined ? -1 : parseInt(ctx.query.limit, 10);
      const options = { reverse, limit };
      const c = await Category.entry(master.db, ctx.params.category);

      switch (ctx.accepts("json", "text")) {
        case "json":
          const it = c.values(master.db, options);

          const values = [];

          for await (const { value, time } of it) {
            values.push({ value, time });
          }

          ctx.body = values;
          break;

        case "text":
          ctx.response.set("content-type", "text/plain");
          ctx.body = c.readStream(master.db, options);
          break;

        default:
          ctx.throw(406, "json, or text only");
      }

      return next();
    }
  );

  /**
   * @swagger
   *
   * /category/{category}/value:
   *   parameters:
   *   - $ref: '#/components/parameters/category'
   *   - name: value
   *     in: body
   *     description: The value itself.
   *     required: true
   *     schema:
   *       type: string
   *   - name: time
   *     in: body
   *     description: Time the value was present.
   *     required: true
   *     schema:
   *       type: string
   *   post:
   *     operationId: insertCategoryValues
   *     description: Insert a value into a category.
   *     responses:
   *       '200':
   *         description: Success message.
   *         content:
   *           'application/json':
   *             schema:
   *               $ref: '#/components/schemas/Message'
   */
  router.addRoute(
    "POST",
    "/category/:category/value",
    restricted,
    BodyParser(),
    async (ctx, next) => {
      enshureEntitlement(ctx, "konsum.value.add");

      const category = await Category.entry(master.db, ctx.params.category);
      const values = ctx.request.body;

      for (const v of Array.isArray(values) ? values : [values]) {
        const time =
          v.time === undefined ? Date.now() : new Date(v.time).valueOf();
        await category.writeValue(master.db, v.value, time / 1000);
      }

      ctx.body = { message: "inserted" };
      return next();
    }
  );

  /**
   * @swagger
   *
   * /category/{category}/value:
   *   parameters:
   *   - $ref: '#/components/parameters/category'
   *   - name: time
   *     in: body
   *     description: Time the value was present.
   *     required: true
   *     schema:
   *       type: string
   *   delete:
   *     operationId: deleteCategoryValues
   *     description: Delete a value from a category.
   *     responses:
   *       '200':
   *         description: Success message.
   *         content:
   *           'application/json':
   *             schema:
   *               $ref: '#/components/schemas/Message'
   */
  router.addRoute(
    "DELETE",
    "/category/:category/value",
    restricted,
    BodyParser(),
    async (ctx, next) => {
      enshureEntitlement(ctx, "konsum.value.delete");

      const category = await Category.entry(master.db, ctx.params.category);
      const body = ctx.request.body;
      await category.deleteValue(master.db, body.key);
      ctx.body = { message: "deleted" };
      return next();
    }
  );

  for (const type of [
    { name: "meter", accessor: "meters", factory: Meter },
    { name: "note", accessor: "notes", factory: Note }
  ]) {
    /**
     * @swagger
     * /category/{category}/meter:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/meter'
     *   get:
     *     operationId: getCategoryMeters
     *     description: List meters of a category.
     *     responses:
     *       '200':
     *         description: List of meters.
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Meter'
     * /category/{category}/note:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/note'
     *   get:
     *     operationId: getCategoryNotes
     *     description: List notes of a category.
     *     responses:
     *       '200':
     *         description: List of notes.
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Note'
     */
    router.addRoute(
      "GET",
      `/category/:category/${type.name}`,
      restricted,
      async (ctx, next) => {
        setNoCacheHeaders(ctx);

        const category = await Category.entry(master.db, ctx.params.category);

        const details = [];

        for await (const detail of category[type.accessor](master.db)) {
          details.push(detail.toJSON());
        }

        ctx.body = details;
        return next();
      }
    );

    /**
     * @swagger
     * /category/{category}/meter:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/meter'
     *   put:
     *     operationId: addCategoryMeter
     *     description: Add a meter to a category.
     *     responses:
     *       '200':
     *         description: Success message.
     *         content:
     *           'application/json':
     *             schema:
     *               $ref: '#/components/schemas/Message'
     * /category/{category}/note:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/note'
     *   put:
     *     operationId: addCategoryNote
     *     description: add a note to a category.
     *     responses:
     *       '200':
     *         description: Success message.
     *         content:
     *           'application/json':
     *             schema:
     *               $ref: '#/components/schemas/Message'
     */
    router.addRoute(
      "PUT",
      `/category/:category/${type.name}`,
      restricted,
      BodyParser(),
      async (ctx, next) => {
        enshureEntitlement(ctx, `konsum.${type.name}.add`);
        setNoCacheHeaders(ctx);

        const category = await Category.entry(master.db, ctx.params.category);
        const body = ctx.request.body;
        const name = body.name;
        delete body.name;
        const t = new type.factory(name, category, body);
        await t.write(master.db);

        ctx.body = { message: "inserted" };
        return next();
      }
    );

    /**
     * @swagger
     * /category/{category}/meter:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/meter'
     *   post:
     *     operationId: updateCategoryMeter
     *     description: Update a meter.
     *     responses:
     *       '200':
     *         description: Success message.
     *         content:
     *           'application/json':
     *             schema:
     *               $ref: '#/components/schemas/Message'
     * /category/{category}/note:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/note'
     *   post:
     *     operationId: updateCategoryNote
     *     description: Update a note.
     *     responses:
     *       '200':
     *         description: Success message.
     *         content:
     *           'application/json':
     *             schema:
     *               $ref: '#/components/schemas/Message'
     */
    router.addRoute(
      "POST",
      `/category/:category/${type.name}`,
      restricted,
      BodyParser(),
      async (ctx, next) => {
        enshureEntitlement(ctx, `konsum.${type.name}.modify`);
        setNoCacheHeaders(ctx);

        const category = await Category.entry(master.db, ctx.params.category);

        // TODO update type
        //category[type](database);

        ctx.body = {};
        return next();
      }
    );

    /**
     * @swagger
     * /category/{category}/meter/{meter}:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/meter'
     *   delete:
     *     operationId: deleteCategoryMeter
     *     description: Delete a meter.
     *     responses:
     *       '200':
     *         description: Success message.
     *         content:
     *           'application/json':
     *             schema:
     *               $ref: '#/components/schemas/Message'
     * /category/{category}/note/{note}:
     *   parameters:
     *   - $ref: '#/components/parameters/category'
     *   - $ref: '#/components/parameters/note'
     *   delete:
     *     operationId: deleteCategoryNote
     *     description: Delete a note.
     *     responses:
     *       '200':
     *         description: Success message.
     *         content:
     *           'application/json':
     *             schema:
     *               $ref: '#/components/schemas/Message'
     */
    router.addRoute(
      "DELETE",
      `/category/:category/${type.name}`,
      restricted,
      async (ctx, next) => {
        enshureEntitlement(ctx, `konsum.${type.name}.delete`);
        setNoCacheHeaders(ctx);

        const category = await Category.entry(master.db, ctx.params.category);

        // TODO delete type
        //category[type](database);

        ctx.body = {};
        return next();
      }
    );
  }

  const server = app.listen(config.http.port, () => {
    console.log("listen on", server.address());
    sd.notify("READY=1\nSTATUS=running");
  });

  return {
    app,
    server,
    router
  };
}


/**
 * @swagger
 * components:
 *   parameters:
 *     category:
 *       name: category
 *       in: path
 *       description: Category identifier.
 *       schema:
 *         type: string
 *     meter:
 *       name: meter
 *       in: path
 *       description: Meter identifier.
 *       schema:
 *         type: string
 *     note:
 *       name: note
 *       in: path
 *       description: Note identifier.
 *       schema:
 *         type: string
 *   securitySchemes:
 *     konsum_auth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Category:
 *       type: object
 *       required:
 *         - id
 *       properties:
 *         id:
 *           type: string
 *           description: The id of the category.
 *         description:
 *           type: string
 *           description: The human readable description of your category.
 *         unit:
 *           type: string
 *           description: The physical measurment unit.
 *       example:
 *         id: EV
 *         description: "mains power"
 *         unit: "m3"
 *     Meter:
 *       type: object
 *       required:
 *         - id
 *       properties:
 *         id:
 *           type: string
 *           description: The id of the meter.
 *         description:
 *           type: string
 *           description: The human readable description of your meter.
 *         unit:
 *           type: string
 *           description: The physical measurment unit.
 *         serial:
 *           type: string
 *           description: The serial number of the meter.
 *     Note:
 *       type: object
 *       required:
 *         - id
 *     Value:
 *       type: object
 *       required:
 *         - id
 *     State:
 *       type: object
 *       properties:
 *         version:
 *           type: string
 *           description: The software version of the server.
 *         uptime:
 *           type: number
 *           description: The duration the sever is up and running.
 *         memory:
 *           type: object
 *           description: The memory usage of the server.
 *     AuthRequest:
 *       type: object
 *       properties:
 *         username:
 *           type: string
 *         password:
 *           type: string
 *     AuthResponse:
 *       type: object
 *       properties:
 *         access_token:
 *           type: string
 *         token_type:
 *           type: string
 *         refresh_token:
 *           type: string
 *         expires_in:
 *           type: string
 *         scope:
 *           type: string
 *     Message:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *     TextOnlyMessage:
 *       type: string
 */
