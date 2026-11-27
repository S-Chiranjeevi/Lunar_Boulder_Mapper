import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getJobResults,
  getJobStatus,
  listImages,
  startProcessingJob,
} from './api/client';
import { AnalysisView } from './components/AnalysisView';
import { ImageIngestPanel } from './components/ImageIngestPanel';
import { ImageLibraryPanel } from './components/ImageLibraryPanel';
import { JobStatusPanel } from './components/JobStatusPanel';
import { ShellHeader, type ShellRoute } from './components/ShellHeader';
import type {
  ImageMetadata,
  ImageUploadResponse,
  JobResultsResponse,
  JobStatusResponse,
  ThresholdProfile,
} from './types/contracts';

function readHashRoute(): ShellRoute {
  return window.location.hash.startsWith('#/analysis') ? 'analysis' : 'workspace';
}

export function App() {
  const [route, setRoute] = useState<ShellRoute>(() => readHashRoute());

  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imagesError, setImagesError] = useState<string | null>(null);

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ThresholdProfile>('lander');

  const [isStartingJob, setIsStartingJob] = useState(false);
  const [jobStartError, setJobStartError] = useState<string | null>(null);

  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);
  const [isPollingJob, setIsPollingJob] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);

  const [results, setResults] = useState<JobResultsResponse | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const navigate = useCallback((next: ShellRoute) => {
    setRoute(next);
    window.location.hash = next === 'analysis' ? '#/analysis' : '#/';
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(readHashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const refreshImages = useCallback(async () => {
    setImagesLoading(true);
    setImagesError(null);
    try {
      const loaded = await listImages();
      setImages(loaded);
      setSelectedImageId((prev) => {
        if (prev && loaded.some((item) => item.image_id === prev)) {
          return prev;
        }
        return loaded[0]?.image_id ?? null;
      });
    } catch (err) {
      setImagesError(
        err instanceof ApiError
          ? err.message
          : 'Failed to load images from the MoonSafe backend.',
      );
    } finally {
      setImagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshImages();
  }, [refreshImages]);

  const fetchResults = useCallback(async (jobId: string) => {
    setResultsLoading(true);
    setResultsError(null);
    try {
      const payload = await getJobResults(jobId);
      setResults(payload);
    } catch (err) {
      setResultsError(
        err instanceof ApiError
          ? err.message
          : 'Failed to load screening results for the completed job.',
      );
    } finally {
      setResultsLoading(false);
    }
  }, []);

  const pollJobOnce = useCallback(
    async (jobId: string) => {
      setIsPollingJob(true);
      setPollingError(null);
      try {
        const status = await getJobStatus(jobId);
        setActiveJob(status);

        if (status.status === 'completed') {
          setIsPollingJob(false);
          void fetchResults(jobId);
          return false;
        }
        if (status.status === 'failed') {
          setIsPollingJob(false);
          return false;
        }
        return true;
      } catch (err) {
        setPollingError(
          err instanceof ApiError ? err.message : 'Unable to check job status.',
        );
        setIsPollingJob(false);
        return false;
      }
    },
    [fetchResults],
  );

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'completed' || activeJob.status === 'failed') {
      return;
    }

    let cancelled = false;
    const scheduleNext = () => {
      pollTimerRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        const shouldContinue = await pollJobOnce(activeJob.job_id);
        if (!cancelled && shouldContinue) {
          scheduleNext();
        }
      }, 1000);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, [activeJob?.job_id, activeJob?.status, pollJobOnce]);

  function handleUploaded(response: ImageUploadResponse) {
    setImages((prev) => {
      const filtered = prev.filter((item) => item.image_id !== response.metadata.image_id);
      return [response.metadata, ...filtered];
    });
    setSelectedImageId(response.image_id);
    setActiveJob(null);
    setResults(null);
    setResultsError(null);
    setPollingError(null);
  }

  async function handleStartJob() {
    if (!selectedImageId) return;
    setIsStartingJob(true);
    setJobStartError(null);
    setResults(null);
    setResultsError(null);
    setPollingError(null);

    try {
      const created = await startProcessingJob({
        image_id: selectedImageId,
        threshold_profile: selectedProfile,
      });
      setActiveJob({
        job_id: created.job_id,
        image_id: created.image_id,
        status: created.status,
        threshold_profile: created.threshold_profile ?? selectedProfile,
      });
      void pollJobOnce(created.job_id);
    } catch (err) {
      setJobStartError(
        err instanceof ApiError ? err.message : 'Failed to submit screening job.',
      );
    } finally {
      setIsStartingJob(false);
    }
  }

  const selectedImage = images.find((img) => img.image_id === selectedImageId) ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0e14] text-slate-100">
      <ShellHeader
        activeRoute={route}
        onNavigate={navigate}
        selectedImage={selectedImage}
        hasActiveJob={Boolean(activeJob)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {route === 'workspace' ? (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <ImageIngestPanel onUploaded={handleUploaded} />
              <ImageLibraryPanel
                images={images}
                isLoading={imagesLoading}
                error={imagesError}
                selectedImageId={selectedImageId}
                selectedProfile={selectedProfile}
                isStartingJob={isStartingJob}
                jobStartError={jobStartError}
                onRefresh={() => void refreshImages()}
                onSelectImage={(id) => {
                  setSelectedImageId(id);
                  setJobStartError(null);
                }}
                onSelectProfile={setSelectedProfile}
                onStartJob={() => void handleStartJob()}
              />
            </div>

            <JobStatusPanel
              job={activeJob}
              pollingError={pollingError}
              isPolling={isPollingJob}
              onOpenAnalysis={() => navigate('analysis')}
              onRetryPoll={() => {
                if (activeJob) void pollJobOnce(activeJob.job_id);
              }}
            />
          </div>
        ) : (
          <AnalysisView
            selectedImage={selectedImage}
            job={activeJob}
            results={results}
            isLoadingResults={resultsLoading}
            resultsError={resultsError}
            onBackToWorkspace={() => navigate('workspace')}
            onRetryResults={() => {
              if (activeJob) void fetchResults(activeJob.job_id);
            }}
          />
        )}
      </main>
    </div>
  );
}

export default App;
