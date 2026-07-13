import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950">
      <SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/board" signInUrl="/sign-in" />
    </div>
  );
}
