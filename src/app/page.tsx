import { isAuthed } from "@/lib/auth";
import LoginForm from "./login-form";
import ConfigTool from "./config-tool";

export const dynamic = "force-dynamic";

export default async function Page() {
  const authed = await isAuthed();
  if (!authed) return <LoginForm />;
  return <ConfigTool />;
}
