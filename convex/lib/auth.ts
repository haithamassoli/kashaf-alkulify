import { ConvexError } from "convex/values";
import { env, type MutationCtx, type QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

const adminEmails = () =>
  env.ADMIN_EMAILS.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

/**
 * Asserts the caller is a signed-in user whose email is listed in the
 * `ADMIN_EMAILS` deployment environment variable. The identity is always
 * derived server-side; it is never accepted as a function argument.
 *
 * @returns the admin's email address.
 */
export const requireAdmin = async (
  ctx: QueryCtx | MutationCtx
): Promise<string> => {
  const user = await authComponent.safeGetAuthUser(ctx);

  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "لم تسجّل الدخول. سجّل الدخول لاستخدام لوحة التحكم.",
    });
  }

  const email = user.email.toLowerCase();

  if (!adminEmails().includes(email)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `الحساب ${user.email} ليس ضمن قائمة المشرفين.`,
    });
  }

  return email;
};
