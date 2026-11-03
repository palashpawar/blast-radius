import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Badge, Box, Button, Heading, Inline, Link, Lozenge, ProgressBar, SectionMessage,
  Spinner, Stack, Strong, Text, User, useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const APPEARANCE = { low: 'success', medium: 'moved', high: 'removed', critical: 'removed' };

function Factor({ f }) {
  return (
    <Inline space="space.100" alignBlock="start">
      <Badge appearance="important" max={100}>{f.points}</Badge>
      <Text><Strong>{f.label}</Strong>{f.detail ? ` — ${f.detail}` : ''}</Text>
    </Inline>
  );
}

function Section({ title, empty, children, items }) {
  return (
    <Stack space="space.075">
      <Heading size="xsmall">{title}</Heading>
      {items.length ? children : <Text>{empty}</Text>}
    </Stack>
  );
}

function App() {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    if (!issueKey) return;
    invoke('analyze', { issueKey }).then(setResult).catch((e) => setError(e.message ?? String(e)));
  }, [issueKey]);

  if (error) return <SectionMessage appearance="error" title="Couldn't analyze this issue"><Text>{error}</Text></SectionMessage>;
  if (!result) return <Inline space="space.100"><Spinner size="small" /><Text>Tracing what this change touches…</Text></Inline>;

  const r = result;
  const risky = r.parents.filter((p) => p.reasons.length);

  const post = async () => {
    setPosting(true);
    try {
      await invoke('postComment', { issueKey });
      setPosted(true);
    } finally {
      setPosting(false);
    }
  };

  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={APPEARANCE[r.level]} isBold>{r.level} · {r.score}/100</Lozenge>
          {r.source === 'jira' && <Lozenge>Jira data only</Lozenge>}
        </Inline>
        <ProgressBar value={r.score / 100} appearance={r.level === 'low' ? 'success' : 'default'} />
        <Text>{r.headline}</Text>
      </Stack>

      <Section title="Why" items={r.factors} empty="No risk factors found.">
        <Stack space="space.075">{r.factors.map((f) => <Factor key={f.id} f={f} />)}</Stack>
      </Section>

      <Section title="What broke here before" items={r.incidents} empty="No related incidents in the last year.">
        <Stack space="space.075">
          {r.incidents.slice(0, 4).map((i) => (
            <Inline key={i.key} space="space.100" alignBlock="start">
              <Lozenge appearance={i.open ? 'removed' : 'default'}>{i.severity}</Lozenge>
              <Text>
                <Link href={`/browse/${i.key}`}>{i.key}</Link> {i.summary} · {i.ageDays}d ago · matches {i.matches.join(', ')}
              </Text>
            </Inline>
          ))}
        </Stack>
      </Section>

      <Section title="What depends on it" items={[...r.dependents, ...r.concurrent, ...risky]} empty="Nothing downstream.">
        <Stack space="space.075">
          {r.dependents.map((d) => (
            <Text key={`d-${d.key}`}>{d.relation} <Link href={`/browse/${d.key}`}>{d.key}</Link> {d.summary}</Text>
          ))}
          {r.concurrent.map((c) => (
            <Text key={`c-${c.key}`}>In progress on the same surface: <Link href={`/browse/${c.key}`}>{c.key}</Link> {c.summary}</Text>
          ))}
          {risky.map((p) => (
            <Text key={`p-${p.key}`}>{p.issuetype} <Link href={`/browse/${p.key}`}>{p.key}</Link> {p.summary}: {p.reasons.join(', ')}</Text>
          ))}
        </Stack>
      </Section>

      {r.code.pullRequests.length > 0 && (
        <Section title="Linked code" items={r.code.pullRequests} empty="">
          <Stack space="space.075">
            {r.code.pullRequests.map((pr) => (
              <Text key={pr.id}><Link href={pr.url}>{pr.name}</Link> {pr.status ? `(${pr.status})` : ''}</Text>
            ))}
          </Stack>
        </Section>
      )}

      <Section title="Loop in" items={r.notify} empty="No one else to notify.">
        <Stack space="space.100">
          {r.notify.slice(0, 5).map((p) => (
            <Inline key={p.accountId} space="space.100" alignBlock="center">
              <User accountId={p.accountId} />
              <Text>{p.reasons.join('; ')}</Text>
            </Inline>
          ))}
        </Stack>
      </Section>

      <Box>
        <Button appearance="primary" onClick={post} isDisabled={posting || posted}>
          {posted ? 'Posted to issue' : posting ? 'Posting…' : 'Post as comment'}
        </Button>
      </Box>

      {r.warnings.length > 0 && (
        <SectionMessage appearance="information" title="Partial data">
          <Stack>{r.warnings.map((w) => <Text key={w}>{w}</Text>)}</Stack>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
