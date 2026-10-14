/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 июн. 2018 г.
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

#ifndef LSP_PLUG_IN_IO_STRINWRITER_H_
#define LSP_PLUG_IN_IO_STRINWRITER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IOutSequence.h>

namespace lsp
{
    namespace io
    {
        class OutStringSequence: public IOutSequence
        {
            private:
                LSPString  *pOut;
                bool        bDelete;

            public:
                explicit OutStringSequence();
                explicit OutStringSequence(LSPString *out, bool del = false);
                OutStringSequence(const OutStringSequence &) = delete;
                OutStringSequence(OutStringSequence &&) = delete;
                virtual ~OutStringSequence() override;

                OutStringSequence & operator = (const OutStringSequence &) = delete;
                OutStringSequence & operator = (OutStringSequence &&) = delete;
    
            public:
                status_t            wrap(LSPString *out, bool del);

            public:
                virtual status_t    write(lsp_wchar_t c) override;
                virtual status_t    write(const lsp_wchar_t *c, size_t count) override;
                virtual status_t    write_ascii(const char *s) override;
                virtual status_t    write_ascii(const char *s, size_t count) override;
                virtual status_t    writeln_ascii(const char *s) override;
                virtual status_t    write(const LSPString *s) override;
                virtual status_t    write(const LSPString *s, ssize_t first) override;
                virtual status_t    write(const LSPString *s, ssize_t first, ssize_t last) override;
                virtual status_t    flush() override;
                virtual status_t    close() override;
        };

    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_STRINWRITER_H_ */
