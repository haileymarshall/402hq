import { Suspense } from "react";
import { AgentDetail } from "@/components/agent-detail";

/** `id` is an agent's on-chain id, or the name of one of ours (/agents/sentinel). */
async function Agent({ params }: { params: PageProps<"/agents/[id]">["params"] }) {
  const { id } = await params;
  return <AgentDetail agentKey={id} />;
}

export default function AgentPage(props: PageProps<"/agents/[id]">) {
  return (
    <Suspense fallback={<div className="pt-24 text-center text-muted">Reading the market…</div>}>
      <Agent params={props.params} />
    </Suspense>
  );
}
