import { LocaleProvider } from "@/components/LocaleProvider";
import { VerifierApp } from "@/components/VerifierApp";

export default function Home() {
  return (
    <LocaleProvider>
      <VerifierApp />
    </LocaleProvider>
  );
}
