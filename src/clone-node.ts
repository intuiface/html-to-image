import type { Options } from './types'
import { clonePseudoElements } from './clone-pseudos'
import {
  createImage,
  toArray,
  isInstanceOfElement,
  emptyImage,
  getStyleProperties,
} from './util'
import { getMimeType } from './mimes'
import { resourceToDataURL } from './dataurl'

async function cloneCanvasElement(canvas: HTMLCanvasElement) {
  const dataURL = canvas.toDataURL()
  if (dataURL === 'data:,') {
    return canvas.cloneNode(false) as HTMLCanvasElement
  }
  return createImage(dataURL)
}

async function cloneVideoElement(video: HTMLVideoElement, options: Options) {
  if (
    (video.currentSrc || video.srcObject) &&
    (video.poster == null || video.poster === '' || video.currentTime > 0)
  ) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = video.clientWidth
    canvas.height = video.clientHeight

    // get object-fit css property of video
    const objectFit = getComputedStyle(video).objectFit

    // get real video size
    const videoWidth = video.videoWidth
    const videoHeight = video.videoHeight

    const canvasWidth = canvas.width
    const canvasHeight = canvas.height

    let sx = 0
    let sy = 0
    let dx = 0
    let dy = 0
    let sw = videoWidth
    let sh = videoHeight
    let dw = canvasWidth
    let dh = canvasHeight
    let scaleW = 1
    let scaleH = 1
    let resizeRatio

    switch (objectFit) {
      case 'fill':
        // compute scale as fill with deform the video
        scaleW = canvasWidth / videoWidth
        scaleH = canvasHeight / videoHeight
        break
      case 'contain':
        // compute ratio (take the min as we want to fit the container)
        resizeRatio = Math.min(
          canvasWidth / videoWidth,
          canvasHeight / videoHeight,
        )
        scaleW = resizeRatio
        scaleH = resizeRatio
        break
      case 'cover':
        // compute ratio, take the max as we can exceed the container
        resizeRatio = Math.max(
          canvasWidth / videoWidth,
          canvasHeight / videoHeight,
        )
        scaleW = resizeRatio
        scaleH = resizeRatio
        break
      case 'none':
        break
      default:
        break
    }

    // compute size
    const resizeWidth = videoWidth * scaleW
    const resizeHeight = videoHeight * scaleH
    // see https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
    // compute position
    if (resizeWidth > canvasWidth) {
      // compute position on source to start copying
      sx = (resizeWidth - canvasWidth) / 2 / scaleW
      // compute source width to draw
      sw -= sx * 2
    } else {
      // compute destination position to start drawing
      dx = (canvasWidth - resizeWidth) / 2
      // compute destination width
      dw -= 2 * dx
    }
    if (resizeHeight > canvasHeight) {
      // compute position on source to start copying
      sy = (resizeHeight - canvasHeight) / 2 / scaleH
      // compute source height to draw
      sh -= sy * 2
    } else {
      // compute destination position to start drawing
      dy = (canvasHeight - resizeHeight) / 2
      // compute destination height
      dh -= 2 * dy
    }

    if (ctx) {
      // draw image
      ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
      const dataURL = canvas.toDataURL()
      return createImage(dataURL)
    }
  }

  if (video.poster == null || video.poster === '') {
    // create an image with the tyniest source found
    return createImage(emptyImage)
  }

  const poster = video.poster
  const contentType = getMimeType(poster)
  const dataURL = await resourceToDataURL(poster, contentType, options)
  return createImage(dataURL)
}

async function cloneIFrameElement(iframe: HTMLIFrameElement, options: Options) {
  try {
    if (iframe?.contentDocument?.body) {
      return (await cloneNode(
        iframe.contentDocument.body,
        options,
        true,
      )) as HTMLBodyElement
    }
  } catch {
    // Failed to clone iframe
  }

  return iframe.cloneNode(false) as HTMLIFrameElement
}

async function cloneSingleNode<T extends HTMLElement>(
  node: T,
  options: Options,
): Promise<HTMLElement> {
  if (isInstanceOfElement(node, HTMLCanvasElement)) {
    return cloneCanvasElement(node)
  }

  if (isInstanceOfElement(node, HTMLVideoElement)) {
    return cloneVideoElement(node, options)
  }

  if (isInstanceOfElement(node, HTMLIFrameElement)) {
    return cloneIFrameElement(node, options)
  }

  return node.cloneNode(isSVGElement(node)) as T
}

const isSlotElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SLOT'

const isSVGElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SVG'

async function cloneChildren<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
): Promise<T> {
  if (isSVGElement(clonedNode)) {
    return clonedNode
  }

  let children: T[] = []

  if (
    isSlotElement(nativeNode) &&
    nativeNode.assignedNodes &&
    nativeNode.assignedNodes().length > 0
  ) {
    children = toArray<T>(nativeNode.assignedNodes())
  } else if (
    nativeNode.parentElement &&
    nativeNode.parentElement.hasAttribute('pdf-document') &&
    !nativeNode.parentElement.classList.contains('book-container')
  ) {
    // Snapshot only one page of a multi-page PDF
    children = toArray<T>(
      (nativeNode.shadowRoot ?? nativeNode).childNodes,
    ).filter((child) => child.getAttribute('isCurrentPage') === 'true')
  } else if (
    isInstanceOfElement(nativeNode, HTMLIFrameElement)
    // && nativeNode.contentDocument?.body
  ) {
    // Iframe's children are already cloned in CloneSingleNode function
    children = [] // toArray<T>(nativeNode.contentDocument.body.childNodes)
  } else {
    children = toArray<T>((nativeNode.shadowRoot ?? nativeNode).childNodes)
  }

  // Keep only visible elements
  children = children.filter(
    (child) => child.style == null || child.style.display !== 'none',
  )

  if (
    children.length === 0 ||
    isInstanceOfElement(nativeNode, HTMLVideoElement)
  ) {
    return clonedNode
  }

  await children.reduce(
    (deferred, child) =>
      deferred
        .then(() => cloneNode(child, options))
        .then((clonedChild: HTMLElement | null) => {
          if (clonedChild) {
            clonedNode.appendChild(clonedChild)
          }
        }),
    Promise.resolve(),
  )

  return clonedNode
}

function cloneCSSStyle<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
) {
  const targetStyle = clonedNode.style
  if (!targetStyle) {
    return
  }

  const sourceStyle = window.getComputedStyle(nativeNode)
  if (sourceStyle.cssText) {
    targetStyle.cssText = sourceStyle.cssText
    targetStyle.transformOrigin = sourceStyle.transformOrigin
  } else {
    getStyleProperties(options).forEach((name) => {
      let value = sourceStyle.getPropertyValue(name)
      if (name === 'font-size' && value.endsWith('px')) {
        const reducedFont =
          Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1
        value = `${reducedFont}px`
      }

      if (
        isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
        name === 'display' &&
        value === 'inline'
      ) {
        value = 'block'
      }

      if (name === 'd' && clonedNode.getAttribute('d')) {
        value = `path(${clonedNode.getAttribute('d')})`
      }

      targetStyle.setProperty(
        name,
        value,
        sourceStyle.getPropertyPriority(name),
      )
    })
  }
}

function cloneInputValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) {
    clonedNode.innerHTML = nativeNode.value
  }

  if (isInstanceOfElement(nativeNode, HTMLInputElement)) {
    clonedNode.setAttribute('value', nativeNode.value)
  }
}

function cloneSelectValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
    const clonedSelect = clonedNode as any as HTMLSelectElement
    const selectedOption = Array.from(clonedSelect.children).find(
      (child) => nativeNode.value === child.getAttribute('value'),
    )

    if (selectedOption) {
      selectedOption.setAttribute('selected', '')
    }
  }
}

function cloneScrollbarPositions<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
) {
  // Snapshot only on page of a multi-page PDF so no need to scroll
  if (nativeNode.hasAttribute('pdf-document')) return

  if (nativeNode.scrollLeft !== 0 || nativeNode.scrollTop !== 0) {
    for (let i = 0; i < clonedNode.children.length; i += 1) {
      const child = clonedNode.childNodes[i] as any as HTMLSelectElement
      if (!child.style) return
      const u = new DOMMatrix(child.style.transform)
      const a = u.a
      const b = u.b
      const c = u.c
      const d = u.d
      u.a = 1
      u.b = 0
      u.c = 0
      u.d = 1
      u.translateSelf(-nativeNode.scrollLeft, -nativeNode.scrollTop)
      u.a = a
      u.b = b
      u.c = c
      u.d = d
      child.style.transform = u.toString()
    }
    clonedNode.style.overflow = 'hidden'
  }
}

function decorate<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
): T {
  if (isInstanceOfElement(clonedNode, Element)) {
    cloneCSSStyle(nativeNode, clonedNode, options)
    clonePseudoElements(nativeNode, clonedNode, options)
    cloneInputValue(nativeNode, clonedNode)
    cloneSelectValue(nativeNode, clonedNode)
    cloneScrollbarPositions(nativeNode, clonedNode)
  }

  return clonedNode
}

async function ensureSVGSymbols<T extends HTMLElement>(
  clone: T,
  options: Options,
) {
  const uses = clone.querySelectorAll ? clone.querySelectorAll('use') : []
  if (uses.length === 0) {
    return clone
  }

  const processedDefs: { [key: string]: HTMLElement } = {}
  for (let i = 0; i < uses.length; i++) {
    const use = uses[i]
    const id = use.getAttribute('xlink:href')
    if (id) {
      const exist = clone.querySelector(id)
      const definition = document.querySelector(id) as HTMLElement
      if (!exist && definition && !processedDefs[id]) {
        // eslint-disable-next-line no-await-in-loop
        processedDefs[id] = (await cloneNode(definition, options, true))!
      }
    }
  }

  const nodes = Object.values(processedDefs)
  if (nodes.length) {
    const ns = 'http://www.w3.org/1999/xhtml'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('xmlns', ns)
    svg.style.position = 'absolute'
    svg.style.width = '0'
    svg.style.height = '0'
    svg.style.overflow = 'hidden'
    svg.style.display = 'none'

    const defs = document.createElementNS(ns, 'defs')
    svg.appendChild(defs)

    for (let i = 0; i < nodes.length; i++) {
      defs.appendChild(nodes[i])
    }

    clone.appendChild(svg)
  }

  return clone
}

export async function cloneNode<T extends HTMLElement>(
  node: T,
  options: Options,
  isRoot?: boolean,
): Promise<T | null> {
  if (!isRoot && options.filter && !options.filter(node)) {
    return null
  }

  return Promise.resolve(node)
    .then((clonedNode) => cloneSingleNode(clonedNode, options) as Promise<T>)
    .then((clonedNode) => cloneChildren(node, clonedNode, options))
    .then((clonedNode) => decorate(node, clonedNode, options))
    .then((clonedNode) => ensureSVGSymbols(clonedNode, options))
}
