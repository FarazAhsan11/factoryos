import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">FactoryOS</CardTitle>
          <CardDescription>
            Next.js + Tailwind CSS + shadcn/ui is ready. Start building.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1">
            <li>Next.js App Router with TypeScript</li>
            <li>Tailwind CSS v4</li>
            <li>
              shadcn/ui components in <code>@/components/ui</code>
            </li>
          </ul>
        </CardContent>
        <CardFooter className="gap-2">
          <Button>Get started</Button>
          <Button variant="outline">Documentation</Button>
        </CardFooter>
      </Card>
    </main>
  );
}
