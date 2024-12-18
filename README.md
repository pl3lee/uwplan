# UWPlan

UWPlan is a degree planning tool for University of Waterloo students to help organize and plan their academic journey.

![Select](/public/assets/select.png)

![Schedule](/public/assets/schedule.png)

Check it out at [uwplan.com](https://uwplan.com)!

## Built With

- Full Stack Framework: [Next.js](https://nextjs.org/)
- Styling: [Tailwind CSS](https://tailwindcss.com/)
- Component Library: [shadcn/ui](https://ui.shadcn.com/)
- Authentication/Authorization: [Auth.js](https://authjs.dev/)
- ORM: [Drizzle ORM](https://orm.drizzle.team/)
- Database: [PostgreSQL](https://www.postgresql.org/)
- Hosting: [Coolify](https://coolify.io/)

## Getting Started

### Development Environment

The easiest way to get started is using VS Code's DevContainer feature, which includes all required dependencies:

1. Install [VS Code](https://code.visualstudio.com/) and the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Clone the repository and open it in VS Code
3. When prompted, click "Reopen in Container" or run the "Dev Containers: Reopen in Container" command

### Manual Setup

If not using DevContainer, you'll need:

- Node.js (v20 or higher)
- npm
- Docker

### Environment Configuration

1. Run `npm install` to install dependencies.
2. Copy `.env.example` to `.env` and fill in the required environment variables by following the steps below.
3. Generate `AUTH_SECRET` by running `npx auth secret` and copying the output into `.env`.
4. Set up GitHub OAuth by creating a new OAuth app in your [GitHub developer settings](https://github.com/settings/developers) and filling in the `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in `.env`. For local development, the Homepage URL is `http://localhost:3000` and the Authorization callback URL is `http://localhost:3000/api/auth/callback/github`.
5. Set up Google OAuth by going to [Google Cloud Console](https://console.cloud.google.com/), creating a new project or choose an existing one, setup OAuth consent screen, then create OAuth client ID in the credentials section. Add `http://localhost:3000` to Authorized JavaScript origins, and `http://localhost:3000/api/auth/callback/google` to Authorized redirect URIs. Copy the client ID and secret to `.env` as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
6. Run `./start-database.sh` to start the PostgreSQL database in a Docker container. If this is the first time running the database, it should generate a password and change `DATABASE_URL` in `.env` for you.
7. Run `npm run db:seed-existing` to seed the database with initial data and migrations.
8. Run `npm run dev` to start the development server. The application should now be running at `http://localhost:3000`.
9. If you need to look at the database tables, you can use `npm run db:studio` to run Drizzle Studio, which would then be accessible at `https://local.drizzle.studio`.

## Database Seeding

If you want to seed the database with existing course data (e.g. for development), you can simply run `npm run db:seed-existing` without needing to run `npm run db:migrate` first. If you then want obtain fresh course data, you can run `npm run courses:update`.

If you want to start with a database with fresh course data, you need to first run `npm run db:migrate` to create the tables, then run `npm run db:seed` to seed the database with fresh data.

To export the database to an SQL file, you can run `npm run db:export` to generate a `data.sql` file. This file can then be used to import the database into another environment.

## Database Design

The database design can be found in [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

## Git Branching Strategy

There are two long-lived branches:

- `main`: which gets automatically deployed to the staging environment [staging.uwplan.com](https://staging.uwplan.com).
- `production`: which gets automatically deployed to the production environment [uwplan.com](https://uwplan.com).

For feature development, create a new branch off of `main` and open a pull request to `main` when ready for review.

Merges to `main` will trigger a deployment to the staging environment. After testing on the staging environment, merge `main` into `production` to trigger a deployment to the production environment.

Note that pull requests to `main` require that the CI checks pass, which includes running tests and linting.

## Contributing

We welcome contributions! Please feel free to submit a Pull Request.

If you encounter any issues or have any feature requests, please open an issue.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
