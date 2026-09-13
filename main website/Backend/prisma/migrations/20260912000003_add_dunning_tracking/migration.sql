-- AlterTable
ALTER TABLE Subscription ADD COLUMN dunningMilestones JSON NULL,
    ADD COLUMN dunningLastEvaluatedAt DATETIME(3) NULL;
