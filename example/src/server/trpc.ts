import { initTRPC } from "@trpc/server";
import { transformer } from "../shared/transformer.js";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { z } from "zod";
import { db } from "./db.js";

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.create({
  transformer,
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

const userRouter = router({
  list: publicProcedure.query(async () => {
    // Retrieve users from a datasource, this is an imaginary database
    const users = await db.user.findMany();
    //    ^?
    return users;
  }),
  byId: publicProcedure.input(z.string()).query(async (opts) => {
    const { input } = opts;
    //      ^?
    // Retrieve the user with the given ID
    const user = await db.user.findById(input);
    return user;
  }),
  create: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async (opts) => {
      const { input } = opts;
      //      ^?
      // Create a new user in the database
      const user = await db.user.create(input);
      //    ^?
      return user;
    }),
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof userRouter;

const server = createHTTPServer({
  router: userRouter,
});

server.listen(3000);
