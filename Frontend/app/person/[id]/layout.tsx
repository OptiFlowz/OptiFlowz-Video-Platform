import type { Metadata } from "next";
import type { PersonResponse } from "~/components/personPage/personPage";
import { createPageMetadata, SITE_URL } from "~/metadata";
import { fetchPublicApi, jsonLd } from "~/seo";

type Props = { children: React.ReactNode; params: Promise<{ id: string }> };
const getPerson = (id: string) => fetchPublicApi<PersonResponse>(`api/people/${encodeURIComponent(id)}`);

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { id } = await params;
  const person = (await getPerson(id))?.person;
  if (!person) return createPageMetadata({ title: "Contributor", path: `/person/${id}`, noIndex: true });
  return createPageMetadata({
    title: person.name,
    description: person.description || `Watch videos featuring ${person.name} on OptiFlowz.`,
    path: `/person/${id}`,
    image: person.image_url,
  });
}

export default async function PersonLayout({ children, params }: Props) {
  const { id } = await params;
  const person = (await getPerson(id))?.person;
  const profile = person ? {
    "@context": "https://schema.org", "@type": "ProfilePage",
    name: person.name, url: `${SITE_URL}/person/${id}`,
    mainEntity: { "@type": "Person", name: person.name, description: person.description || undefined, image: person.image_url || undefined },
  } : null;
  return <>{profile && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(profile) }} />}{children}</>;
}
