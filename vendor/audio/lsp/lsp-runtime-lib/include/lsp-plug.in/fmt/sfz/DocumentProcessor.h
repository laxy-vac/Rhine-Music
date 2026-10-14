/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 23 февр. 2023 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_FMT_SFZ_DOCUMENTPROCESSOR_H_
#define LSP_PLUG_IN_FMT_SFZ_DOCUMENTPROCESSOR_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/fmt/sfz/IDocumentHandler.h>
#include <lsp-plug.in/fmt/sfz/PullParser.h>
#include <lsp-plug.in/io/InSharedMemoryStream.h>
#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/lltl/pphash.h>

namespace lsp
{
    namespace sfz
    {
        /**
         * SFZ document processor. Allows to perform easy context-aware processing of the SFZ document.
         * The settings for headers <global>, <master>, <group> become merged into the <region> seciton.
         * This allows to simplify parse due no need of parsing <global>, <master> and <group> headers
         * by the document handler.
         */
        class LSP_RUNTIME_LIB_PUBLIC DocumentProcessor
        {
            protected:
                enum scope_t
                {
                    SC_NONE,        // No scope
                    SC_CONTROL,     // Control scope
                    SC_GLOBAL,      // Global scope
                    SC_MASTER,      // Master scope
                    SC_GROUP,       // Group scope
                    SC_REGION,      // Region scope
                    SC_OTHER,       // Any other scope

                    SC_TOTAL
                };

                enum other_t
                {
                    OT_SAMPLE,
                    OT_MIDI,
                    OT_CURVE,
                    OT_EFFECT,
                    OT_CUSTOM
                };

                typedef struct document_t
                {
                    char                       *sPath;      // Path to the original file or NULL
                    PullParser                 *pParser;    // Parser of the associated file
                    size_t                      nWFlags;    // Wrapping flags for the processor
                } document_t;

                typedef struct scope_data_t
                {
                    lltl::pphash<char, char>    vOpcodes;   // Opcodes
                    lltl::parray<char>          vAllocated; // Allocated opcodes

                    scope_t                     enType;     // Type of scope
                    other_t                     enOther;    // The sub-type of SC_OTHER scope
                    char                       *sName;      // The name of header or of the sample
                    io::InSharedMemoryStream    sData;      // The sample data for <sample>
                    scope_data_t               *pPrev;      // Pervious scope
                } scope_data_t;

            protected:
                lltl::parray<document_t>        vTree;
                lltl::pphash<char, char>        vVars;      // Variables defined
                scope_data_t                    vScopes[SC_TOTAL];
                scope_data_t                   *pScope;
                ssize_t                         nScopes;

            protected:
                static document_t  *create_document();
                static status_t     destroy_document(document_t *doc);
                static status_t     init_scope(scope_data_t *scope, scope_t type, scope_data_t *prev);
                static void         clear_scope(scope_data_t *scope);
                static void         drop_hash(lltl::pphash<char, char> *data);
                static scope_t      get_scope(const LSPString *header);

            protected:
                status_t            switch_scope(IDocumentHandler *handler, scope_t scope);
                status_t            dispatch_scope(IDocumentHandler *handler, scope_data_t *scope);
                status_t            process_header(IDocumentHandler *handler, event_t *ev);
                status_t            process_opcode(event_t *ev);
                status_t            process_include(IDocumentHandler *handler, event_t *ev);
                status_t            process_define(IDocumentHandler *handler, document_t *doc, event_t *ev);
                status_t            process_sample_data(IDocumentHandler *handler, event_t *ev);
                status_t            main_loop(IDocumentHandler *handler);
                char               *process_value(const LSPString *value);

            public:
                DocumentProcessor();
                virtual ~DocumentProcessor();

            public:
                /**
                 * Open processor
                 * @param path UTF-8 path to the file
                 * @return status of operation
                 */
                status_t    open(const char *path);

                /**
                 * Open processor
                 * @param path string representation of path to the file
                 * @return status of operation
                 */
                status_t    open(const LSPString *path);

                /**
                 * Open processor
                 * @param path path to the file
                 * @return status of operation
                 */
                status_t    open(const io::Path *path);

                /**
                 * Wrap string with processor
                 * @param str string to wrap
                 * @return status of operation
                 */
                status_t    wrap(const char *str);

                /**
                 * Wrap string with parser
                 * @param buf buffer to wrap
                 * @param len length of buffer to wrap
                 * @return status of operation
                 */
                status_t    wrap(const void *buf, size_t len);

                /**
                 * Wrap string with processor
                 * @param str string to wrap
                 * @return status of operation
                 */
                status_t    wrap(const LSPString *str);

                /**
                 * Wrap input stream with processor
                 * @param is input stream
                 * @param flags wrap flags
                 * @return status of operation
                 */
                status_t    wrap(io::IInStream *is, size_t flags = WRAP_NONE);

                /**
                 * Wrap pull parser with the processor
                 * @param parser parser to wrap
                 * @param flags wrap flags
                 * @return status of operation
                 */
                status_t    wrap(PullParser *parser, size_t flags = WRAP_NONE);

                /**
                 * Process the document using the supplied document handler
                 * @param handler document handler to supply the data
                 * @return status of operation
                 */
                status_t    process(IDocumentHandler *handler);

                /**
                 * Close parser
                 * @return status of operation
                 */
                status_t    close();
        };

    } /* namespace sfz */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_SFZ_DOCUMENTPROCESSOR_H_ */
