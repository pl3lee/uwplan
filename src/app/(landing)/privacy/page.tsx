export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-8 text-4xl font-bold tracking-tighter">
        Privacy Policy
      </h1>

      <div className="prose prose-gray dark:prose-invert max-w-none">
        <section className="mb-8">
          <h2 className="mb-4 text-2xl font-semibold">
            Information We Collect
          </h2>
          <p className="mb-4 text-muted-foreground">
            We collect information that you provide directly to us when you use
            UWPlan:
          </p>
          <ul className="mb-4 list-disc pl-6 text-muted-foreground">
            <li>Your University of Waterloo email address</li>
            <li>Your program and academic information</li>
            <li>Course selections and schedules you create</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-2xl font-semibold">
            How We Use Your Information
          </h2>
          <p className="mb-4 text-muted-foreground">
            We use the information we collect to:
          </p>
          <ul className="mb-4 list-disc pl-6 text-muted-foreground">
            <li>Provide and improve UWPlan services</li>
            <li>Save your course selections and degree progress</li>
            <li>Send important updates about UWPlan</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-2xl font-semibold">
            Data Storage and Security
          </h2>
          <p className="mb-4 text-muted-foreground">
            Your data is stored securely and we take reasonable measures to
            protect it. We do not sell your personal information to third
            parties.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-2xl font-semibold">Your Rights</h2>
          <p className="mb-4 text-muted-foreground">You have the right to:</p>
          <ul className="mb-4 list-disc pl-6 text-muted-foreground">
            <li>Access your personal information</li>
            <li>Request deletion of your data</li>
            <li>Opt out of communications</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-2xl font-semibold">Contact Us</h2>
          <p className="text-muted-foreground">
            If you have any questions about this Privacy Policy, please contact
            us at{" "}
            <a
              href="mailto:privacy@uwplan.ca"
              className="text-primary hover:underline"
            >
              privacy@uwplan.ca
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
