import './Tabs.css'

const tabNames = [
  '.net',
  'ajax',
  'android',
  'angular',
  'api',
  'arrays',
  'asp.net',
  'aws',
  'c',
  'c#',
  'c++',
  'css',
  'database',
  'dataframe',
  'django',
  'docker',
  'express',
  'flask',
  'flutter',
  'git',
  'graphql',
  'hooks',
  'html',
  'ios',
  'java',
  'javascript',
  'jquery',
  'json',
  'kubernetes',
  'linux',
]

export function Tabs() {
  return (
    <section className="tabs-page">
      <div className="tabs-header">
        <h1>Tags</h1>
        <p className="tabs-subtitle">
          Browse all tags and topics. Click to drill in later.
        </p>
      </div>
      <div className="tabs-grid">
        {tabNames.map((tag) => (
          <button key={tag} type="button" className="tabs-card">
            <span className="tabs-chip">{tag}</span>
            <p className="tabs-desc">
              Discussions, questions, and best practices about {tag}.
            </p>
            <div className="tabs-meta">
              <span className="tabs-count">{Math.floor(Math.random() * 1200) + 40} questions</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
