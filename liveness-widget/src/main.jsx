import React from 'react'
import ReactDOM from 'react-dom/client'
import reactToWebComponent from 'react-to-webcomponent'
import FaceLivenessWidget from './widget.jsx'

// Registrar o custom element
const FaceLivenessElement = reactToWebComponent(FaceLivenessWidget, React, ReactDOM)
customElements.define('face-liveness-widget', FaceLivenessElement)
