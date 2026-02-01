export interface Question {
  id: string
  title: string
  content: string
  author: string
  answers: number
  views: number
  votes: number
  tags: string[]
  created: string
}

const mockQuestions: Question[] = [
  {
    id: '1',
    title: 'How to center a div in CSS?',
    content: 'I\'ve been trying to center a div using flexbox but it\'s not working as expected.',
    author: 'john_doe',
    answers: 3,
    views: 245,
    votes: 12,
    tags: ['css', 'html', 'layout'],
    created: '2 hours ago',
  },
  {
    id: '2',
    title: 'Best practices for React hooks',
    content: 'What are the best practices when using React hooks in functional components?',
    author: 'react_pro',
    answers: 5,
    views: 1203,
    votes: 87,
    tags: ['react', 'javascript', 'hooks'],
    created: '1 day ago',
  },
  {
    id: '3',
    title: 'TypeScript generics explained',
    content: 'Can someone explain TypeScript generics with some practical examples?',
    author: 'ts_learner',
    answers: 2,
    views: 456,
    votes: 34,
    tags: ['typescript', 'programming', 'generics'],
    created: '3 days ago',
  },
  {
    id: '4',
    title: 'How to optimize database queries?',
    content: 'My application is running slow. How can I optimize my database queries?',
    author: 'db_expert',
    answers: 7,
    views: 2103,
    votes: 156,
    tags: ['database', 'sql', 'performance'],
    created: '1 week ago',
  },
  {
    id: '5',
    title: 'Git workflow best practices',
    content: 'What is the best git workflow for a team of developers?',
    author: 'git_master',
    answers: 4,
    views: 892,
    votes: 67,
    tags: ['git', 'version-control', 'workflow'],
    created: '2 weeks ago',
  },
  {
    id: '6',
    title: 'Understanding async/await in JavaScript',
    content: 'I\'m confused about async/await. Can you provide some clear examples?',
    author: 'async_seeker',
    answers: 6,
    views: 3451,
    votes: 234,
    tags: ['javascript', 'async', 'promises'],
    created: '3 weeks ago',
  },
]

export function Questions() {
  return (
    <div className="questions-container">
      <div className="questions-header">
        <h1>Questions</h1>
        <p className="questions-subtitle">Browse all questions from the community</p>
      </div>
      
      <div className="questions-grid">
        {mockQuestions.map((question) => (
          <div key={question.id} className="question-box">
            <div className="question-stats">
              <div className="stat-item">
                <div className="stat-number">{question.votes}</div>
                <div className="stat-label">votes</div>
              </div>
              <div className="stat-item">
                <div className="stat-number">{question.answers}</div>
                <div className="stat-label">answers</div>
              </div>
              <div className="stat-item">
                <div className="stat-number">{question.views}</div>
                <div className="stat-label">views</div>
              </div>
            </div>
            
            <div className="question-content">
              <h3 className="question-title">{question.title}</h3>
              <p className="question-excerpt">{question.content}</p>
              
              <div className="question-meta">
                <div className="question-tags">
                  {question.tags.map((tag) => (
                    <span key={tag} className="question-tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="question-info">
                  <span className="question-author">{question.author}</span>
                  <span className="question-time">{question.created}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
