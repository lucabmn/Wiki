import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div role="status" className="flex h-full items-center justify-center pt-8">
      <Loader2 className="animate-spin" aria-hidden />
      <span className="sr-only">Wird geladen …</span>
    </div>
  );
}
