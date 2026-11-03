# Codegeist submission notes

## Installation link (Jira)

https://developer.atlassian.com/console/install/ad069c60-c61c-47d4-9e97-0bf1ded23484?signature=AYABeNCbVkEir8efnV8uKaYhUjgAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBd6dWogj46LIwwSTPQlQh4AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDNvXn1eF7IXLtCAwmgIBEIA7aIs7vb7QZ3W%2BRXxKd55M0aCw9sD99HshJ%2F3bCLW2E43%2BwYrLrQ%2B2FuKP9vlQ0By3TEi4Y1APw5KP02YAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHqPYWkZjTNQm6pqnfPoj8FAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMTE2xto1v08KwljriAgEQgDtOqpONdNsi913K4reCF%2FrDySOZbMOiT%2BE9c9jD8NpKjNKWDRGnPgMhXy4OPoflewxFANGEDj8hsy0x8QAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAVyymaSHPnNnFR%2BI8cclrw8AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAy2Al4D4zkpn1c8vqUCARCAO%2FBKAWAzLralOxVRb8SE9kgtxcFBlzOdMA4q5ocoy3jzINg4pQG8u5hpwttAZhIfxehNDoiq7k6wuk8yAgAAAAAMAAAQAAAAAAAAAAAAAAAAAKMi9F2FwHNS2fqfZid%2FtRT%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADKasSZvTGDxMcGJXFfUmg1NVyqe8%2B8q6N4hgoAa6BxjtIqaXj0ylv8oqYEVGUJclWSCkwdkSt9yY4geYGzhbSBXeyw%3D&product=jira

App id: `ad069c60-c61c-47d4-9e97-0bf1ded23484` (production environment)

## Instructions for judges

1. Open the installation link, choose **Get app**, and pick a Jira Cloud site you administer.
2. Open any work item, click the **Apps** button under the title, and choose **Blast Radius**.
   The panel scores the change 0–100 and lists the factors, related incidents, dependent
   and concurrent work, at-risk epics, and who to loop in.
3. Rovo: open **Agents** on a work item and pick **Blast Radius**, or ask
   "What's the blast radius of <KEY>?".
4. MCP: an org admin enables the app's tools under admin.atlassian.com → Apps → Sites →
   Connected apps → Blast Radius, then any MCP client connects to
   `https://mcp.atlassian.com/forge/ad069c60-c61c-47d4-9e97-0bf1ded23484`.
5. For meaningful results the site needs a JSM project with incidents that share
   components or labels with the work item. `npm run seed` in this repo builds the
   demo data used in the video.

## Category and bonus prizes

- Category: **Apps for Software Teams**
- Best Agents: `rovo:agent` + four `action` modules
- Best app with Atlassian MCP: `rovo:mcp` exposing three of those actions
- Teamwork Graph (optional): persisted Cypher queries run in production; they need a
  connected GitHub/Bitbucket repo to return PRs and services

## How it meets the technology requirement

Built on Forge (`nodejs22.x`), integrating Jira, Jira Service Management, Rovo
(agent, actions, MCP) and the Teamwork Graph API. See README.md for the architecture
and scoring model.
