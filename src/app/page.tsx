import { SignInButton, Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/board");
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col">
      <header className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900">
        <h1 className="text-xl font-bold text-white tracking-tight">K-TodoList</h1>
        <div>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="px-4 py-2 border border-neutral-700 rounded-md text-sm font-medium hover:bg-neutral-800 transition-colors">
                Sign In
              </button>
            </SignInButton>
          </Show>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8 bg-neutral-950">
        <Card className="max-w-2xl w-full bg-neutral-900 border-neutral-800 text-white">
          <CardHeader>
            <CardTitle className="text-3xl font-extrabold tracking-tight">Welcome to K-TodoList</CardTitle>
            <CardDescription className="text-neutral-400">
              Manage your tasks efficiently with Capacity Warnings, Kanban boards, and Gantt charts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-neutral-300">
              Please check the <code className="bg-neutral-800 px-1 py-0.5 rounded text-primary">.env.local</code> file and ensure you have added your Clerk and Convex API keys.
            </p>
            <div className="p-4 bg-neutral-800/50 rounded border border-neutral-800">
              You are currently signed out. Please sign in to access your dashboard.
            </div>
            <SignInButton mode="modal">
              <button className="w-full bg-white text-black hover:bg-neutral-200 py-2 rounded-md font-medium transition-colors">
                Sign In to Continue
              </button>
            </SignInButton>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
