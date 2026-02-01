-- Create votes table for questions and answers
-- This table stores upvotes and downvotes from users

-- Drop the table if it exists (to handle any partial creation)
DROP TABLE IF EXISTS public.votes CASCADE;

CREATE TABLE public.votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    answer_id UUID REFERENCES answers(id) ON DELETE CASCADE,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('upvote', 'downvote')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure a user can only vote once per question or answer
    -- We'll handle this with a unique partial index instead
    
    -- Ensure either question_id or answer_id is set, but not both
    CONSTRAINT votes_item_check CHECK (
        (question_id IS NOT NULL AND answer_id IS NULL) OR
        (question_id IS NULL AND answer_id IS NOT NULL)
    )
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_question_id ON votes(question_id);
CREATE INDEX IF NOT EXISTS idx_votes_answer_id ON votes(answer_id);
-- Unique partial indexes to ensure one vote per user per question/answer
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_user_question_unique ON votes(user_id, question_id) WHERE question_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_user_answer_unique ON votes(user_id, answer_id) WHERE answer_id IS NOT NULL;

-- Enable Row Level Security (RLS)
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all votes
CREATE POLICY "Anyone can view votes" ON votes
    FOR SELECT
    USING (true);

-- Policy: Users can create their own votes
CREATE POLICY "Users can create their own votes" ON votes
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own votes
CREATE POLICY "Users can update their own votes" ON votes
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own votes
CREATE POLICY "Users can delete their own votes" ON votes
    FOR DELETE
    USING (auth.uid() = user_id);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.votes TO authenticated;
GRANT SELECT ON public.votes TO anon;

