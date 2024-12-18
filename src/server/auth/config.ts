import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";

import { db } from "@/server/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  plans,
  schedules,
  userTermRanges,
} from "@/server/db/schema";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  providers: [
    Google,
    GitHub,
    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Discord provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
  ],
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
      },
    }),
  },
  events: {
    createUser: async ({ user }) => {
      if (!user.id) {
        throw new Error("User ID is required");
      }

      try {
        const result = await db.insert(plans).values({
          userId: user.id,
        }).returning({
          id: plans.id,
        })
        const planId = result?.[0]?.id;
        if (!planId) {
          throw new Error("Failed to create plan for new user");
        }
        await db.insert(schedules).values({
          name: "Default",
          planId
        })
        await db.insert(userTermRanges).values({
          userId: user.id,
          startTerm: "Fall",
          startYear: new Date().getFullYear(),
          endTerm: "Fall",
          endYear: new Date().getFullYear() + 5,
        })
      } catch (error) {
        console.error("Failed to create plan or schedule for new user:", error);
        throw error;
      }
    },
  },
} satisfies NextAuthConfig;
