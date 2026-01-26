// ERYAI_AUTO_GENERATED - DO NOT EDIT
// This file is managed by eryai-core-schema broadcast
// To customize, remove the line above and your changes will be preserved

import { createSwaggerSpec } from 'next-swagger-doc';

export default function handler(req, res) {
  try {
    const spec = createSwaggerSpec({
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'EryAI API',
          version: '1.0.0',
          description: 'Auto-generated API specification'
        },
      },
      apiFolder: 'pages/api',
    });
    res.status(200).json(spec);
  } catch (error) {
    // Fallback if next-swagger-doc is not installed or fails
    res.status(200).json({
      openapi: '3.0.0',
      info: {
        title: 'EryAI API',
        version: '1.0.0'
      },
      paths: {}
    });
  }
}
