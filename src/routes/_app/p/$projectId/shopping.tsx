import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import { ShoppingPage } from "@/client/features/shopping/ShoppingPage";

export const Route = createFileRoute("/_app/p/$projectId/shopping")({
  remountDeps: ({ params }) => params.projectId,
  component: ShoppingRoute,
});

function ShoppingRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Shopping Prices"
          description="Compare your product prices with Google Shopping and your competitors"
        />
        <ShoppingPage projectId={projectId} />
      </div>
    </div>
  );
}
