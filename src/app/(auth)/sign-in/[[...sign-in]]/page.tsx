import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950">
      <SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/board" signUpUrl="/sign-up" />
    </div>
  );
}
