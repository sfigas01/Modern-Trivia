let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) throw new Error('X-Replit-Token not found');

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=linear',
    { headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken } }
  ).then((res: any) => res.json()).then((data: any) => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
  if (!connectionSettings || !accessToken) throw new Error('Linear not connected');
  return accessToken;
}

async function graphql(accessToken: string, query: string, variables: Record<string, any> = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) {
    console.error('GraphQL errors:', JSON.stringify(data.errors, null, 2));
  }
  return data;
}

function parseIdentifier(identifier: string): { teamKey: string; number: number } {
  const match = identifier.match(/^([A-Z]+)-(\d+)$/);
  if (!match) throw new Error(`Invalid identifier format: ${identifier}. Expected e.g. STE-14`);
  return { teamKey: match[1], number: parseInt(match[2], 10) };
}

async function main() {
  const action = process.argv[2];
  const accessToken = await getAccessToken();

  if (action === 'search') {
    const identifier = process.argv[3] || 'STE-14';
    const { teamKey, number } = parseIdentifier(identifier);

    const data: any = await graphql(accessToken, `
      query($number: Float!, $teamKey: String!) {
        issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }) {
          nodes { id identifier title state { id name } team { id } }
        }
      }
    `, { number, teamKey });

    const issues = data.data?.issues?.nodes || [];
    if (issues.length === 0) {
      console.log('No issues found for', identifier);
    }
    for (const issue of issues) {
      console.log(`ID: ${issue.id} | ${issue.identifier} | ${issue.title} | State: ${issue.state?.name}`);
    }
  } else if (action === 'done') {
    const identifier = process.argv[3];
    if (!identifier) { console.error('Usage: done <identifier e.g. STE-14>'); process.exit(1); }
    const { teamKey, number } = parseIdentifier(identifier);

    const issueData: any = await graphql(accessToken, `
      query($number: Float!, $teamKey: String!) {
        issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }) {
          nodes { id identifier team { id } }
        }
      }
    `, { number, teamKey });

    const issue = issueData.data?.issues?.nodes?.[0];
    if (!issue) { console.error('Issue not found:', identifier); process.exit(1); }

    const statesData: any = await graphql(accessToken, `
      query($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name type }
        }
      }
    `, { teamId: issue.team.id });

    const doneState = statesData.data?.workflowStates?.nodes?.find((s: any) => s.name.toLowerCase() === 'done');
    if (!doneState) { console.error('Could not find Done state'); process.exit(1); }

    const result: any = await graphql(accessToken, `
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }
    `, { id: issue.id, input: { stateId: doneState.id } });

    console.log('Updated', identifier, 'to Done:', result.data?.issueUpdate?.success);
  } else if (action === 'comment') {
    const identifier = process.argv[3];
    const body = process.argv[4];
    if (!identifier || !body) { console.error('Usage: comment <identifier> <body>'); process.exit(1); }
    const { teamKey, number } = parseIdentifier(identifier);

    const issueData: any = await graphql(accessToken, `
      query($number: Float!, $teamKey: String!) {
        issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }) {
          nodes { id identifier }
        }
      }
    `, { number, teamKey });

    const issue = issueData.data?.issues?.nodes?.[0];
    if (!issue) { console.error('Issue not found:', identifier); process.exit(1); }

    const result: any = await graphql(accessToken, `
      mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }
    `, { issueId: issue.id, body });

    console.log('Comment posted on', identifier + ':', result.data?.commentCreate?.success);
  } else {
    console.log('Usage: search <identifier> | done <identifier> | comment <identifier> <body>');
  }
}

main().catch(console.error);
