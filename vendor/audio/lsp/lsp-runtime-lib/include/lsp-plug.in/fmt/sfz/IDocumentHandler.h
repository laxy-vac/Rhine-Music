/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_FMT_SFZ_IDOCUMENTHANDLER_H_
#define LSP_PLUG_IN_FMT_SFZ_IDOCUMENTHANDLER_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/sfz/PullParser.h>
#include <lsp-plug.in/io/IInStream.h>

namespace lsp
{
    namespace sfz
    {
        /**
         * SFZ document handler interface.
         * It allows to handle and process SFZ data in a simple way.
         */
        class LSP_RUNTIME_LIB_PUBLIC IDocumentHandler
        {
            public:
                IDocumentHandler();
                virtual ~IDocumentHandler();

            public:
                /**
                 * Notify the handler about start of the document processing
                 * @return status of operation
                 */
                virtual status_t begin();

                /**
                 * Handle the control header content
                 * @param opcodes NULL-terminated list of all opcodes including the opcodes from parent headers
                 * @param values NULL-terminated list of all opcode values that match the opcodes
                 * @return status of operation
                 */
                virtual status_t control(const char **opcodes, const char **values);

                /**
                 * Handle the region header content. The merged values from <global>, <master>, <group> and <region>
                 * are passed to the method.
                 * @param opcodes NULL-terminated list of all opcodes including the opcodes from parent headers
                 * @param values NULL-terminated list of all opcode values that match the opcodes
                 * @return status of operation
                 */
                virtual status_t region(const char **opcodes, const char **values);

                /**
                 * Handle the sample data embedded into the SFZ file
                 * @param name name of the file
                 * @param data the stream that represents the contents of the file
                 * @param opcodes NULL-terminated list of all opcodes specific for this header only
                 * @param values NULL-terminated list of all opcode specific for this header only
                 * @return status of operation
                 */
                virtual status_t sample(
                    const char *name, io::IInStream *data,
                    const char **opcodes, const char **values);

                /**
                 * Handle the effect header content
                 * @param opcodes NULL-terminated list of all opcodes specific for this header only
                 * @param values NULL-terminated list of all opcode specific for this header only
                 * @return status of operation
                 */
                virtual status_t effect(const char **opcodes, const char **values);

                /**
                 * Handle the midi header content
                 * @param opcodes NULL-terminated list of all opcodes specific for this header only
                 * @param values NULL-terminated list of all opcode specific for this header only
                 * @return status of operation
                 */
                virtual status_t midi(const char **opcodes, const char **values);

                /**
                 * Handle the curve header content
                 * @param opcodes NULL-terminated list of all opcodes specific for this header only
                 * @param values NULL-terminated list of all opcode specific for this header only
                 * @return status of operation
                 */
                virtual status_t curve(const char **opcodes, const char **values);

                /**
                 * Handle another non-standard specific header content
                 * @param opcodes NULL-terminated list of all opcodes specific for this header only
                 * @param values NULL-terminated list of all opcode specific for this header only
                 * @return status of operation
                 */
                virtual status_t custom_header(const char *name, const char **opcodes, const char **values);

                /**
                 * Handle the include directive
                 * @param parser the parser that should be used to open or wrap file contents
                 * @param name the name of the file to include
                 * @return status of operation
                 */
                virtual status_t include(PullParser *parser, const char *name);

                /**
                 * Return the name of the root file (optional). Can be called when the document
                 * processor wraps the stream/memory chunk or SFZ file parser
                 * @return name of the root file associated with the handler or NULL
                 */
                virtual const char *root_file_name();

                /**
                 * Notify the handler about end of the document processing
                 * This callback is only called if no one error occurred during the processing
                 * @param result the oveall status of processing
                 * @return status of operation
                 */
                virtual status_t end(status_t result);
        };

    } /* namespace sfz */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_SFZ_IDOCUMENTHANDLER_H_ */
