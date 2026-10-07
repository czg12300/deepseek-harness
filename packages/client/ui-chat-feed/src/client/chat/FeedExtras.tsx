/** Session image groups and the generic tool renderer for isolated feeds. */
import { useEffect, useState } from 'react'
import type { MessageImagesProps } from '../contract/slots.ts'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'

function FeedImage({ image, loadImage }: { image: MessageImageSource; loadImage: MessageImagesProps['loadImage'] }) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let current = true
    setUrl(undefined)
    setError(undefined)
    if ('preview' in image) setUrl(image.preview.url)
    else void loadImage(image.attachment).then((value) => { if (current) setUrl(value) }, (reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [image, loadImage])
  if (error) return <p role="alert">{error}</p>
  return url ? <img src={url} alt="" style={{ maxWidth: '100%' }} /> : null
}

/** @param props - authorized message images. @returns image tiles. */
export function FeedImages({ images, loadImage }: MessageImagesProps) {
  return <>{images.map((image, index) => <FeedImage key={index} image={image} loadImage={loadImage} />)}</>
}

